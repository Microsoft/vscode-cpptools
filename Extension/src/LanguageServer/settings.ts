/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { CommentPattern } from './languageConfig';
import { getExtensionFilePath } from '../common';
import * as os from 'os';
import * as which from 'which';
import { execSync } from 'child_process';
import * as semver from 'semver';

function getTarget(): vscode.ConfigurationTarget {
    return (vscode.workspace.workspaceFolders) ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global;
}

class Settings {
    private readonly settings: vscode.WorkspaceConfiguration;

    /**
     * create the Settings object.
     * @param resource The path to a resource to which the settings should apply, or undefined if global settings are desired
     */
    constructor(section: string, resource?: vscode.Uri) {
        this.settings = vscode.workspace.getConfiguration(section, resource ? resource : null);
    }

    protected get Section(): vscode.WorkspaceConfiguration { return this.settings; }

    protected getWithFallback<T>(section: string, deprecatedSection: string): T {
        let info: any = this.settings.inspect<T>(section);
        if (info.workspaceFolderValue !== undefined) {
            return info.workspaceFolderValue;
        } else if (info.workspaceValue !== undefined) {
            return info.workspaceValue;
        } else if (info.globalValue !== undefined) {
            return info.globalValue;
        }
        let value: T | undefined = this.settings.get<T>(deprecatedSection);
        if (value !== undefined) {
            return value;
        }
        return info.defaultValue;
    }

    protected getWithNullAsUndefined<T>(section: string): T | undefined {
        let result: T | undefined | null = this.settings.get<T>(section);
        if (result === null) {
            return undefined;
        }
        return result;
    }
}

export class CppSettings extends Settings {
    constructor(resource?: vscode.Uri) {
        super("C_Cpp", resource);
    }

    private get clangFormatName(): string {
        switch (os.platform()) {
            case "win32":
                return "clang-format.exe";
            case "darwin":
                return "clang-format.darwin";
            case "linux":
            default:
                return "clang-format";
        }
    }

    public get clangFormatPath(): string | undefined {
        let path: string | undefined | null = super.Section.get<string>("clang_format_path");
        if (!path) {
            path = which.sync('clang-format', {nothrow: true});
            if (!path) {
                return undefined;
            } else {
                // Attempt to invoke both our own version of clang-format to see if we can successfully execute it, and to get it's version.
                let clangFormatVersion: string;
                try {
                    let exePath: string = getExtensionFilePath(`./LLVM/bin/${this.clangFormatName}`);
                    let output: string[] = execSync(`${exePath} --version`).toString().split(" ");
                    if (output.length < 3 || output[0] !== "clang-format" || output[1] !== "version" || !semver.valid(output[2])) {
                        return path;
                    }
                    clangFormatVersion = output[2];
                } catch (e) {
                    // Unable to invoke our own clang-format.  Use the system installed clang-format.
                    return path;
                }

                // Invoke the version on the system to compare versions.  Use ours if it's more recent.
                try {
                    let output: string[] = execSync(`"${path}" --version`).toString().split(" ");
                    if (output.length < 3 || output[0] !== "clang-format" || output[1] !== "version" || semver.ltr(output[2], clangFormatVersion)) {
                        path = "";
                    }
                } catch (e) {
                    path = "";
                }
            }
        }
        return path;
    }

    public get clangFormatStyle(): string | undefined { return super.Section.get<string>("clang_format_style"); }
    public get clangFormatFallbackStyle(): string | undefined { return super.Section.get<string>("clang_format_fallbackStyle"); }
    public get clangFormatSortIncludes(): string | undefined { return super.Section.get<string>("clang_format_sortIncludes"); }
    public get formatting(): string | undefined { return super.Section.get<string>("formatting"); }
    public get experimentalFeatures(): string | undefined { return super.Section.get<string>("experimentalFeatures"); }
    public get suggestSnippets(): boolean | undefined { return super.Section.get<boolean>("suggestSnippets"); }
    public get intelliSenseEngine(): string | undefined { return super.Section.get<string>("intelliSenseEngine"); }
    public get intelliSenseEngineFallback(): string | undefined { return super.Section.get<string>("intelliSenseEngineFallback"); }
    public get intelliSenseCachePath(): string | undefined { return super.Section.get<string>("intelliSenseCachePath"); }
    public get intelliSenseCacheSize(): number | undefined { return super.Section.get<number>("intelliSenseCacheSize"); }
    public get errorSquiggles(): string | undefined { return super.Section.get<string>("errorSquiggles"); }
    public get inactiveRegionOpacity(): number | undefined { return super.Section.get<number>("inactiveRegionOpacity"); }
    public get inactiveRegionForegroundColor(): string | undefined { return super.Section.get<string>("inactiveRegionForegroundColor"); }
    public get inactiveRegionBackgroundColor(): string | undefined { return super.Section.get<string>("inactiveRegionBackgroundColor"); }
    public get autoComplete(): string | undefined { return super.Section.get<string>("autocomplete"); }
    public get loggingLevel(): string | undefined { return super.Section.get<string>("loggingLevel"); }
    public get autoAddFileAssociations(): boolean | undefined { return super.Section.get<boolean>("autoAddFileAssociations"); }
    public get workspaceParsingPriority(): string | undefined { return super.Section.get<string>("workspaceParsingPriority"); }
    public get workspaceSymbols(): string | undefined { return super.Section.get<string>("workspaceSymbols"); }
    public get exclusionPolicy(): string | undefined { return super.Section.get<string>("exclusionPolicy"); }
    public get commentContinuationPatterns(): (string | CommentPattern)[] | undefined { return super.Section.get<(string | CommentPattern)[]>("commentContinuationPatterns"); }
    public get configurationWarnings(): string | undefined { return super.Section.get<string>("configurationWarnings"); }
    public get preferredPathSeparator(): string | undefined { return super.Section.get<string>("preferredPathSeparator"); }
    public get updateChannel(): string | undefined { return super.Section.get<string>("updateChannel"); }
    public get vcpkgEnabled(): boolean | undefined { return super.Section.get<boolean>("vcpkg.enabled"); }
    public get renameRequiresIdentifier(): boolean | undefined { return super.Section.get<boolean>("renameRequiresIdentifier"); }
    public get defaultIncludePath(): string[] | undefined { return super.Section.get<string[]>("default.includePath"); }
    public get defaultDefines(): string[] | undefined { return super.Section.get<string[]>("default.defines"); }
    public get defaultMacFrameworkPath(): string[] | undefined { return super.Section.get<string[]>("default.macFrameworkPath"); }
    public get defaultWindowsSdkVersion(): string | undefined { return super.Section.get<string>("default.windowsSdkVersion"); }
    public get defaultCompileCommands(): string | undefined { return super.Section.get<string>("default.compileCommands"); }
    public get defaultForcedInclude(): string[] | undefined { return super.Section.get<string[]>("default.forcedInclude"); }
    public get defaultIntelliSenseMode(): string | undefined { return super.Section.get<string>("default.intelliSenseMode"); }
    public get defaultCompilerPath(): string | undefined {
        let result: string | undefined | null = super.Section.get<string | null>("default.compilerPath");
        if (result === null) {
            return undefined;
        }
        return result;
    }
    public get defaultCompilerArgs(): string[] | undefined { return super.Section.get<string[]>("default.compilerArgs"); }
    public get defaultCStandard(): string | undefined { return super.Section.get<string>("default.cStandard"); }
    public get defaultCppStandard(): string | undefined { return super.Section.get<string>("default.cppStandard"); }
    public get defaultConfigurationProvider(): string | undefined { return super.Section.get<string>("default.configurationProvider"); }
    public get defaultBrowsePath(): string[] | undefined { return super.Section.get<string[]>("default.browse.path"); }
    public get defaultDatabaseFilename(): string | undefined { return super.Section.get<string>("default.browse.databaseFilename"); }
    public get defaultLimitSymbolsToIncludedHeaders(): boolean | undefined { return super.Section.get<boolean>("default.browse.limitSymbolsToIncludedHeaders"); }
    public get defaultSystemIncludePath(): string[] | undefined { return super.Section.get<string[]>("default.systemIncludePath"); }
    public get defaultEnableConfigurationSquiggles(): boolean | undefined { return super.Section.get<boolean>("default.enableConfigurationSquiggles"); }

    public get enhancedColorization(): boolean {
        return super.Section.get<string>("enhancedColorization") === "Enabled"
            && super.Section.get<string>("intelliSenseEngine") === "Default"
            && vscode.workspace.getConfiguration("workbench").get<string>("colorTheme") !== "Default High Contrast";
    }

    public get dimInactiveRegions(): boolean {
        return super.Section.get<boolean>("dimInactiveRegions") === true
            && super.Section.get<string>("intelliSenseEngine") === "Default"
            && vscode.workspace.getConfiguration("workbench").get<string>("colorTheme") !== "Default High Contrast";
    }

    public toggleSetting(name: string, value1: string, value2: string): void {
        let value: string | undefined = super.Section.get<string>(name);
        super.Section.update(name, value === value1 ? value2 : value1, getTarget());
    }

    public update<T>(name: string, value: T): void {
        super.Section.update(name, value);
    }
}

export interface TextMateRuleSettings {
    foreground?: string;
    background?: string;
    fontStyle?: string;
}

export interface TextMateRule {
    scope: any;
    settings: TextMateRuleSettings;
}

export class OtherSettings {
    private resource: vscode.Uri | null;

    constructor(resource?: vscode.Uri | null) {
        if (!resource) {
            resource = null;
        }
        this.resource = resource;
    }

    public get editorTabSize(): number | undefined { return vscode.workspace.getConfiguration("editor", this.resource).get<number>("tabSize"); }
    public get filesAssociations(): any { return vscode.workspace.getConfiguration("files", null).get("associations"); }
    public set filesAssociations(value: any) {
        vscode.workspace.getConfiguration("files", null).update("associations", value, vscode.ConfigurationTarget.Workspace);
    }
    public get filesExclude(): vscode.WorkspaceConfiguration | undefined { return vscode.workspace.getConfiguration("files", this.resource).get("exclude"); }
    public get searchExclude(): vscode.WorkspaceConfiguration | undefined { return vscode.workspace.getConfiguration("search", this.resource).get("exclude"); }
    public get settingsEditor(): string | undefined { return vscode.workspace.getConfiguration("workbench.settings").get<string>("editor"); }

    public get colorTheme(): string | undefined { return vscode.workspace.getConfiguration("workbench").get<string>("colorTheme"); }

    public getCustomColorToken(colorTokenName: string): string | undefined { return vscode.workspace.getConfiguration("editor.tokenColorCustomizations").get<string>(colorTokenName); }
    public getCustomThemeSpecificColorToken(themeName: string, colorTokenName: string): string | undefined { return vscode.workspace.getConfiguration(`editor.tokenColorCustomizations.[${themeName}]`, this.resource).get<string>(colorTokenName); }

    public get customTextMateRules(): TextMateRule[] | undefined { return vscode.workspace.getConfiguration("editor.tokenColorCustomizations").get<TextMateRule[]>("textMateRules"); }
    public getCustomThemeSpecificTextMateRules(themeName: string): TextMateRule[] | undefined { return vscode.workspace.getConfiguration(`editor.tokenColorCustomizations.[${themeName}]`, this.resource).get<TextMateRule[]>("textMateRules"); }
}
