/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { Client } from './client';
import { ReferencesCommandMode, referencesCommandModeToString } from './references';
import { getCustomConfigProviders, CustomConfigurationProviderCollection, isSameProviderExtensionId } from './customProviders';
import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

let ui: UI;

interface IndexableQuickPickItem extends vscode.QuickPickItem {
    index: number;
}
interface KeyedQuickPickItem extends vscode.QuickPickItem {
    key: string;
}

// Higher numbers mean greater priority.
enum ConfigurationPriority {
    IncludePath = 1,
    CompileCommands = 2,
    CustomProvider = 3,
}

interface ConfigurationResult {
    configured: boolean;
    priority: ConfigurationPriority;
}

export class UI {
    private configStatusBarItem: vscode.StatusBarItem;
    private browseEngineStatusBarItem: vscode.StatusBarItem;
    private intelliSenseStatusBarItem: vscode.StatusBarItem;
    private referencesStatusBarItem: vscode.StatusBarItem;
    private configurationUIPromise?: Thenable<ConfigurationResult>;
    private readonly referencesPreviewTooltip: string = ` (${localize("click.to.preview", "click to preview results")})`;

    constructor() {

        this.configStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
        this.configStatusBarItem.command = "C_Cpp.ConfigurationSelect";
        this.configStatusBarItem.tooltip = localize("c.cpp.configuration.tooltip", "C/C++ Configuration");
        this.ShowConfiguration = true;

        this.referencesStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 901);
        this.referencesStatusBarItem.text = "";
        this.referencesStatusBarItem.tooltip = "";
        this.referencesStatusBarItem.color = new vscode.ThemeColor("statusBar.foreground");
        this.referencesStatusBarItem.command = "C_Cpp.ShowReferencesProgress";
        this.ShowReferencesIcon = true;

        this.intelliSenseStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 903);
        this.intelliSenseStatusBarItem.text = "";
        this.intelliSenseStatusBarItem.tooltip = localize("updating.intellisense.tooltip", "Updating IntelliSense...");
        this.intelliSenseStatusBarItem.color = new vscode.ThemeColor("statusBar.foreground");
        this.ShowFlameIcon = true;

        this.browseEngineStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 902);
        this.browseEngineStatusBarItem.text = "";
        this.browseEngineStatusBarItem.tooltip = localize("discovering.files.tooltip", "Discovering files...");
        this.browseEngineStatusBarItem.color = new vscode.ThemeColor("statusBar.foreground");
        this.browseEngineStatusBarItem.command = "C_Cpp.ShowParsingCommands";
        this.ShowDBIcon = true;
    }

    private set ActiveConfig(label: string) {
        this.configStatusBarItem.text = label;
    }

    private set TagParseStatus(label: string) {
        this.browseEngineStatusBarItem.tooltip = label;
    }

    private get IsTagParsing(): boolean {
        return this.browseEngineStatusBarItem.text !== "";
    }
    private set IsTagParsing(val: boolean) {
        this.browseEngineStatusBarItem.text = val ? "$(database)" : "";
        this.ShowDBIcon = val;
    }

    private get IsUpdatingIntelliSense(): boolean {
        return this.intelliSenseStatusBarItem.text !== "";
    }

    private set IsUpdatingIntelliSense(val: boolean) {
        this.intelliSenseStatusBarItem.text = val ? "$(flame)" : "";
        this.ShowFlameIcon = val;
    }

    private get ReferencesCommand(): ReferencesCommandMode {
        return this.referencesStatusBarItem.tooltip === "" ? ReferencesCommandMode.None :
            (this.referencesStatusBarItem.tooltip === referencesCommandModeToString(ReferencesCommandMode.Find) ? ReferencesCommandMode.Find :
                (this.referencesStatusBarItem.tooltip === referencesCommandModeToString(ReferencesCommandMode.Rename) ? ReferencesCommandMode.Rename :
                    ReferencesCommandMode.Peek));
    }

    private set ReferencesCommand(val: ReferencesCommandMode) {
        if (val === ReferencesCommandMode.None) {
            this.referencesStatusBarItem.text = "";
            this.ShowReferencesIcon = false;
        } else {
            this.referencesStatusBarItem.text = "$(search)";
            this.referencesStatusBarItem.tooltip =  referencesCommandModeToString(val) + (val !== ReferencesCommandMode.Find ? "" : this.referencesPreviewTooltip);
            this.ShowReferencesIcon = true;
        }
    }

    // Prevent icons from appearing too often and for too short of a time.
    private readonly iconDelayTime: number = 1000;

    private dbTimeout?: NodeJS.Timeout;
    private set ShowDBIcon(show: boolean) {
        if (this.dbTimeout) {
            clearTimeout(this.dbTimeout);
        }
        if (show && this.IsTagParsing) {
            this.dbTimeout = setTimeout(() => { this.browseEngineStatusBarItem.show(); }, this.iconDelayTime);
        } else {
            this.dbTimeout = setTimeout(() => { this.browseEngineStatusBarItem.hide(); }, this.iconDelayTime);
        }
    }

    private flameTimeout?: NodeJS.Timeout;
    private set ShowFlameIcon(show: boolean) {
        if (this.flameTimeout) {
            clearTimeout(this.flameTimeout);
        }
        if (show && this.IsUpdatingIntelliSense) {
            this.flameTimeout = setTimeout(() => { this.intelliSenseStatusBarItem.show(); }, this.iconDelayTime);
        } else {
            this.flameTimeout = setTimeout(() => { this.intelliSenseStatusBarItem.hide(); }, this.iconDelayTime);
        }
    }

    private set ShowReferencesIcon(show: boolean) {
        if (show && this.ReferencesCommand !== ReferencesCommandMode.None) {
            this.referencesStatusBarItem.show();
        } else {
            this.referencesStatusBarItem.hide();
        }
    }

    private set ShowConfiguration(show: boolean) {
        if (show) {
            this.configStatusBarItem.show();
        } else {
            this.configStatusBarItem.hide();
        }
    }

    public activeDocumentChanged(): void {
        let activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
        if (!activeEditor) {
            this.ShowConfiguration = false;
        } else {
            let isCpp: boolean = (activeEditor.document.uri.scheme === "file" && (activeEditor.document.languageId === "cpp" || activeEditor.document.languageId === "c"));

            // It's sometimes desirable to see the config and icons when making settings changes.
            let isSettingsJson: boolean = ((activeEditor.document.fileName.endsWith("c_cpp_properties.json") || activeEditor.document.fileName.endsWith("settings.json")));

            this.ShowConfiguration = isCpp || isSettingsJson;
        }
    }

    public bind(client: Client): void {
        client.TagParsingChanged(value => { this.IsTagParsing = value; });
        client.IntelliSenseParsingChanged(value => { this.IsUpdatingIntelliSense = value; });
        client.ReferencesCommandModeChanged(value => { this.ReferencesCommand = value; });
        client.TagParserStatusChanged(value => { this.TagParseStatus = value; });
        client.ActiveConfigChanged(value => { this.ActiveConfig = value; });
    }

    public showConfigurations(configurationNames: string[]): Thenable<number> {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = localize("select.a.configuration", "Select a Configuration...");

        let items: IndexableQuickPickItem[] = [];
        for (let i: number = 0; i < configurationNames.length; i++) {
            items.push({ label: configurationNames[i], description: "", index: i });
        }
        items.push({ label: localize("edit.configuration.ui", "Edit Configurations (UI)"), description: "", index: configurationNames.length });
        items.push({ label: localize("edit.configuration.json", "Edit Configurations (JSON)"), description: "", index: configurationNames.length + 1 });

        return vscode.window.showQuickPick(items, options)
            .then(selection => (selection) ? selection.index : -1);
    }

    public showConfigurationProviders(currentProvider?: string): Thenable<string | undefined> {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = localize("select.configuration.provider", "Select a Configuration Provider...");
        let providers: CustomConfigurationProviderCollection = getCustomConfigProviders();

        let items: KeyedQuickPickItem[] = [];
        providers.forEach(provider => {
            let label: string = provider.name;
            if (isSameProviderExtensionId(currentProvider, provider.extensionId)) {
                label += ` (${localize("active", "active")})`;
            }
            items.push({ label: label, description: "", key: provider.extensionId });
        });
        items.push({ label: `(${localize("none", "none")})`, description: localize("disable.configuration.provider", "Disable the active configuration provider, if applicable."), key: "" });

        return vscode.window.showQuickPick(items, options)
            .then(selection => (selection) ? selection.key : undefined);
    }

    public showCompileCommands(paths: string[]): Thenable<number> {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = localize("select.compile.commands", "Select a compile_commands.json...");

        let items: IndexableQuickPickItem[] = [];
        for (let i: number = 0; i < paths.length; i++) {
            items.push({label: paths[i], description: "", index: i});
        }

        return vscode.window.showQuickPick(items, options)
            .then(selection => (selection) ? selection.index : -1);
    }

    public showWorkspaces(workspaceNames: { name: string; key: string }[]): Thenable<string> {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = localize("select.workspace", "Select a workspace folder...");

        let items: KeyedQuickPickItem[] = [];
        workspaceNames.forEach(name => items.push({ label: name.name, description: "", key: name.key }));

        return vscode.window.showQuickPick(items, options)
            .then(selection => (selection) ? selection.key : "");
    }

    public showParsingCommands(): Thenable<number> {
        let options: vscode.QuickPickOptions = {};
        options.placeHolder = localize("select.parsing.command", "Select a parsing command...");

        let items: IndexableQuickPickItem[];
        items = [];
        if (this.browseEngineStatusBarItem.tooltip === "Parsing paused") {
            items.push({ label: localize("resume.parsing", "Resume Parsing"), description: "", index: 1 });
        } else {
            items.push({ label: localize("pause.parsing", "Pause Parsing"), description: "", index: 0 });
        }

        return vscode.window.showQuickPick(items, options)
            .then(selection => (selection) ? selection.index : -1);
    }

    public showConfigureIncludePathMessage(prompt: () => Thenable<boolean>, onSkip: () => void): void {
        setTimeout(() => {
            this.showConfigurationPrompt(ConfigurationPriority.IncludePath, prompt, onSkip);
        }, 10000);
    }

    public showConfigureCompileCommandsMessage(prompt: () => Thenable<boolean>, onSkip: () => void): void {
        setTimeout(() => {
            this.showConfigurationPrompt(ConfigurationPriority.CompileCommands, prompt, onSkip);
        }, 5000);
    }

    public showConfigureCustomProviderMessage(prompt: () => Thenable<boolean>, onSkip: () => void): void {
        this.showConfigurationPrompt(ConfigurationPriority.CustomProvider, prompt, onSkip);
    }

    private showConfigurationPrompt(priority: ConfigurationPriority, prompt: () => Thenable<boolean>, onSkip: () => void): void {
        let showPrompt: () => Thenable<ConfigurationResult> = async () => {
            let configured: boolean = await prompt();
            return Promise.resolve({
                priority: priority,
                configured: configured
            });
        };

        if (this.configurationUIPromise) {
            this.configurationUIPromise = this.configurationUIPromise.then(result => {
                if (priority > result.priority) {
                    return showPrompt();
                } else if (!result.configured) {
                    return showPrompt();
                }
                onSkip();
                return Promise.resolve({
                    priority: result.priority,
                    configured: true
                });
            });
        } else {
            this.configurationUIPromise = showPrompt();
        }
    }

    public dispose(): void {
        this.configStatusBarItem.dispose();
        this.browseEngineStatusBarItem.dispose();
        this.intelliSenseStatusBarItem.dispose();
        this.referencesStatusBarItem.dispose();
    }
}

export function getUI(): UI {
    if (!ui) {
        ui = new UI();
    }
    return ui;
}
