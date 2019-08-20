/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');
const env = require('gulp-env')
const tslint = require('gulp-tslint');
const mocha = require('gulp-mocha');
const fs = require('fs');
const optionsSchemaGenerator = require('./out/tools/GenerateOptionsSchema');
const nls = require('vscode-nls-dev');
const path = require('path');
const minimist = require('minimist');
const es = require('event-stream');
const sourcemaps = require('gulp-sourcemaps');
const ts = require('gulp-typescript');
const typescript = require('typescript');
const tsProject = ts.createProject('./tsconfig.json', { typescript });
const filter = require('gulp-filter');
const vinyl = require('vinyl');
const parse5 = require('parse5');
const traverse = require('parse5-traverse');
const jsonc = require('jsonc-parser'); // Used to allow comments in nativeStrings.json


// Patterns to find HTML files
const htmlFilesPatterns = [
    "ui/**/*.html"
];

const jsonSchemaFilesPatterns = [
    "*.schema.json"
];

const languages = [
    { id: "zh-TW", folderName: "cht", transifexId: "zh-hant" },
    { id: "zh-CN", folderName: "chs", transifexId: "zh-hans" },
    { id: "fr", folderName: "fra" },
    { id: "de", folderName: "deu" },
    { id: "it", folderName: "ita" },
    { id: "es", folderName: "esn" },
    { id: "ja", folderName: "jpn" },
    { id: "ko", folderName: "kor" },
    { id: "ru", folderName: "rus" },
    { id: "bg", folderName: "bul" }, // VS Code supports Bulgarian, but VS is not currently localized for it
    { id: "hu", folderName: "hun" }, // VS Code supports Hungarian, but VS is not currently localized for it
    { id: "pt-br", folderName: "ptb", transifexId: "pt-BR" },
    { id: "tr", folderName: "trk" },
    { id: "cs", folderName: "csy" },
    { id: "pl", folderName: "plk" }
];

gulp.task('unitTests', (done) => {
    env.set({
            CODE_TESTS_PATH: "./out/test/unitTests",
        });

    return gulp.src('./test/runVsCodeTestsWithAbsolutePaths.js', {read: false})
        .pipe(mocha({ ui: "tdd" }))
        .once('error', err => {
            done();
            process.exit(1);
        })
        .once('end', () => {
            done();
            process.exit();
        });
});

/// Misc Tasks
const allTypeScript = [
    'src/**/*.ts',
    '!**/*.d.ts',
    '!**/typings**'
];

const lintReporter = (output, file, options) => {
    //emits: src/helloWorld.c:5:3: warning: implicit declaration of function ‘prinft’
    let relativeBase = file.base.substring(file.cwd.length + 1).replace('\\', '/');
    output.forEach(e => {
        let message = relativeBase + e.name + ':' + (e.startPosition.line + 1) + ':' + (e.startPosition.character + 1) + ': ' + e.failure;
        console.log('[tslint] ' + message);
    });
};

gulp.task('tslint', () => {
    return gulp.src(allTypeScript)
        .pipe(tslint({
            program: require('tslint').Linter.createProgram("./tsconfig.json"),
            configuration: "./tslint.json"
        }))
        .pipe(tslint.report(lintReporter, {
            summarizeFailureOutput: false,
            emitError: false
        }))
});

gulp.task('pr-check', (done) => {
    const packageJson = JSON.parse(fs.readFileSync('./package.json').toString());
    if (packageJson.activationEvents.length !== 1 && packageJson.activationEvents[0] !== '*') {
        console.log('Please make sure to not check in package.json that has been rewritten by the extension activation. If you intended to have changes in package.json, please only check-in your changes. If you did not, please run `git checkout -- package.json`.');
        done();
        process.exit(1);
    }

    done();
});

gulp.task('generateOptionsSchema', (done) => {
    optionsSchemaGenerator.generateOptionsSchema();
    done();
});


// ****************************
// Command: translations-export
// The following is used to export and XLF file containing english strings for translations.
// The result will be written to: ../vscode-extensions-localization-export/ms-vscode/
// ****************************

const translationProjectName  = "vscode-extensions";
const translationExtensionName  = "vscode-cpptools";

function removePathPrefix(path, prefix) {
    if (!prefix) {
        return path;
    }
    if (!path.startsWith(prefix)) {
        return path;
    }
    if (path === prefix) {
        return "";
    }
    let ch = prefix.charAt(prefix.length - 1);
    if (ch === '/' || ch === '\\') {
        return path.substr(prefix.length);
    }
    ch = path.charAt(prefix.length);
    if (ch === '/' || ch === '\\') {
        return path.substr(prefix.length + 1);
    }
    return path;
}

// Helper to traverse HTML tree
// nodeCallback(locId, node) is invoked for nodes
// attributeCallback(locId, attribute) is invoked for attribtues
const traverseHtml = (contents, nodeCallback, attributeCallback) => {
    const htmlTree = parse5.parse(contents);
    traverse(htmlTree, {
        pre(node, parent) {
            if (node.attrs) {
                // Check if content text should be localized based on presense of data-loc-id attribute
                let locId = node.attrs.find(attribute => attribute.name.toLowerCase() == "data-loc-id");
                if (locId) {
                    nodeCallback(locId.value, node);
                }
                // Check if an attribute should be localized based on presense of data-loc-id-<attribute_name> attribute
                node.attrs.forEach(attribute => {
                    const dataLocIdAttributePrefix = "data-loc-id-";
                    if (attribute.name.startsWith(dataLocIdAttributePrefix))
                    {
                        let targetAttributeName = attribute.name.substring(dataLocIdAttributePrefix.length);
                        let targetAttribute = node.attrs.find(a => a.name == targetAttributeName);
                        if (targetAttribute) {
                            attributeCallback(attribute.value, targetAttribute);
                        }
                    }
                });
            }
        }
    });
    return htmlTree;
};

// Traverses the HTML document looking for node and attributes containing data-loc-id, to localize
// Outputs *.nls.json files containing strings to localize.
const processHtmlFiles = () => {
    return es.through(function (file) {
        let localizationJsonContents = {};
        let localizationMetadataContents = {
            messages: [],
            keys: [],
            filePath: removePathPrefix(file.path, file.cwd)
        };
        let nodeCallback = (locId, node) => {
            let subNodeCount = 0;
            let text = "";
            node.childNodes.forEach((childNode) => {
                if (childNode.nodeName == "#text") {
                    text += childNode.value;
                } else {
                    text += `{${subNodeCount++}}`;
                }
            });
            localizationJsonContents[locId.value] = text;
            localizationMetadataContents.keys.push(locId);
            localizationMetadataContents.messages.push(text);
        };
        let attributeCallback = (locId, attribute) => {
            localizationJsonContents[locId] = attribute.value;
            localizationMetadataContents.keys.push(locId);
            localizationMetadataContents.messages.push(attribute.value);
        };
        traverseHtml(file.contents.toString(), nodeCallback, attributeCallback);
        this.queue(new vinyl({
            path: path.join(file.path + '.nls.json'),
            contents: Buffer.from(JSON.stringify(localizationJsonContents, null, '\t'), 'utf8')
        }));
        this.queue(new vinyl({
            path: path.join(file.path + '.nls.metadata.json'),
            contents: Buffer.from(JSON.stringify(localizationMetadataContents, null, '\t'), 'utf8')
        }));
    });
};

// descriptionCallback(path, value, parent) is invoked for attribtues
const traverseJson = (jsonTree, descriptionCallback, prefixPath) => {
    for (let fieldName in jsonTree) {
        if (jsonTree[fieldName] !== null) {
            if (typeof(jsonTree[fieldName]) == "string" && fieldName === "description") {
                descriptionCallback(prefixPath, jsonTree[fieldName], jsonTree);
            } else if (typeof(jsonTree[fieldName]) == "object") {
                let path = prefixPath;
                if (path !== "")
                    path = path + ".";
                path = path + fieldName;
                traverseJson(jsonTree[fieldName], descriptionCallback, path);
            }
        }
    }
};

// Traverses schema json files looking for "description" fields to localized.
// The path to the "description" field is used to create a localization key.
const processJsonSchemaFiles = () => {
    return es.through(function (file) {
        let jsonTree = JSON.parse(file.contents.toString());
        let localizationJsonContents = {};
        let filePath = removePathPrefix(file.path, file.cwd);
        let localizationMetadataContents = {
            messages: [],
            keys: [],
            filePath: filePath
        };
        let descriptionCallback = (path, value, parent) => {
            let locId = filePath + "." + path;
            localizationJsonContents[locId] = value;
            localizationMetadataContents.keys.push(locId);
            localizationMetadataContents.messages.push(value);
        };
        traverseJson(jsonTree, descriptionCallback, "");
        this.queue(new vinyl({
            path: path.join(file.path + '.nls.json'),
            contents: Buffer.from(JSON.stringify(localizationJsonContents, null, '\t'), 'utf8')
        }));
        this.queue(new vinyl({
            path: path.join(file.path + '.nls.metadata.json'),
            contents: Buffer.from(JSON.stringify(localizationMetadataContents, null, '\t'), 'utf8')
        }));
    });
};

gulp.task("translations-export", (done) => {

    // Transpile the TS to JS, and let vscode-nls-dev scan the files for calls to localize.
    let jsStream = tsProject.src()
        .pipe(sourcemaps.init())
        .pipe(tsProject()).js
        .pipe(nls.createMetaDataFiles());
    
    // Scan html files for tags with the data-loc-id attribute
    let htmlStream = gulp.src(htmlFilesPatterns)
        .pipe(processHtmlFiles());

    let jsonSchemaStream = gulp.src(jsonSchemaFilesPatterns)
        .pipe(processJsonSchemaFiles());

    // Merge files from all source streams
    es.merge(jsStream, htmlStream, jsonSchemaStream)

    // Filter down to only the files we need
    .pipe(filter(['**/*.nls.json', '**/*.nls.metadata.json']))

    // Consoldate them into nls.metadata.json, which the xlf is built from.
    .pipe(nls.bundleMetaDataFiles('ms-vscode.cpptools', '.'))

    // filter down to just the resulting metadata files
    .pipe(filter(['**/nls.metadata.header.json', '**/nls.metadata.json']))

    // Add package.nls.json, used to localized package.json
    .pipe(gulp.src(["package.nls.json"]))

    // package.nls.json and nls.metadata.json are used to generate the xlf file
    // Does not re-queue any files to the stream.  Outputs only the XLF file
    .pipe(nls.createXlfFiles(translationProjectName, translationExtensionName))
    .pipe(gulp.dest(path.join("..", `${translationProjectName}-localization-export`)))
    .pipe(es.wait(() => {
        done();
    }));
});


// ****************************
// Command: translations-import
// The following is used to import an XLF file containing all language strings.
// This results in a i18n directory, which should be checked in.
// ****************************

// Imports translations from raw localized MLCP strings to VS Code .i18n.json files
gulp.task("translations-import", (done) => {
    let options = minimist(process.argv.slice(2), {
        string: "location",
        default: {
            location: "../vscode-translations-import"
        }
    });
    es.merge(languages.map((language) => {
        let id = language.transifexId || language.id;
        // This path needs to be revisited once we iron out the process for receiving this xlf and running this scripts.
        return gulp.src(path.join(options.location, id, translationProjectName, `${translationExtensionName}.xlf`), { allowEmpty: true })
            .pipe(nls.prepareJsonFiles())
            .pipe(gulp.dest(path.join("./i18n", language.folderName)));
    }))
    .pipe(es.wait(() => {
        done();
    }));
});


// ****************************
// Command: translations-generate
// The following is used to import an i18n directory structure and generate files used at runtime.
// ****************************

// Generate package.nls.*.json files from: ./i18n/*/package.i18n.json
// Outputs to root path, as these nls files need to be along side package.json
const generatedAdditionalLocFiles = () => {
    return gulp.src(['package.nls.json'])
        .pipe(nls.createAdditionalLanguageFiles(languages, 'i18n'))
        .pipe(gulp.dest('.'));
};

// Generates ./dist/nls.bundle.<language_id>.json from files in ./i18n/** *//<src_path>/<filename>.i18n.json
// Localized strings are read from these files at runtime.
const generatedSrcLocBundle = () => {
    // Transpile the TS to JS, and let vscode-nls-dev scan the files for calls to localize.
    return tsProject.src()
        .pipe(sourcemaps.init())
        .pipe(tsProject()).js
        .pipe(nls.createMetaDataFiles())
        .pipe(nls.createAdditionalLanguageFiles(languages, "i18n"))
        .pipe(nls.bundleMetaDataFiles('ms-vscode.cpptools', 'dist'))
        .pipe(nls.bundleLanguageFiles())
        .pipe(filter(['**/nls.bundle.*.json', '**/nls.metadata.header.json', '**/nls.metadata.json']))
        .pipe(gulp.dest('dist'));
};

const generateLocalizedHtmlFiles = () => {
    return es.through(function (file) {
        let relativePath = removePathPrefix(file.path, file.cwd);
        languages.map((language) => {
            let stringTable = {};
            // Try to open i18n file for this file
            let relativePath = removePathPrefix(file.path, file.cwd);
            let locFile = path.join("./i18n", language.folderName, relativePath + ".i18n.json");
            if (fs.existsSync(locFile)) {
                stringTable = JSON.parse(fs.readFileSync(locFile).toString());
            }
            // Entire file is scanned and modified, then serialized for that language.
            // Even if no translations are available, we still write new files to dist/html/...

            // Rewrite child nodes to fill in {0}, {1}, etc., in localized string.
            let nodeCallback = (locId, node) => {
                let locString = stringTable[locId];
                if (locString) {
                    let nonTextChildNodes = node.childNodes.filter(childNode => childNode.nodeName != "#text");
                    let textParts = locString.split(/\{[0-9]+\}/);
                    let matchParts = locString.match(/\{[0-9]+\}/);
                    let newChildNodes = [];
                    let i = 0;
                    for (; i < textParts.length - 1; i ++) {
                        if (textParts[i] != "") {
                            newChildNodes.push({ nodeName: "#text", value: textParts[i]});
                        }
                        let childIndex = matchParts[i].match(/[0-9]+/);
                        newChildNodes.push(nonTextChildNodes[childIndex]);
                    }
                    if (textParts[i] != "") {
                        newChildNodes.push({ nodeName: "#text", value: textParts[i]});
                    }
                    node.childNodes = newChildNodes;
                }
            };
            let attributeCallback = (locId, attribute) => {
                let value = stringTable[locId];
                if (value) {
                    attribute.value = value;
                }
            };
            let htmlTree = traverseHtml(file.contents.toString(), nodeCallback, attributeCallback);
            let newContent = parse5.serialize(htmlTree);
            this.queue(new vinyl({
                path: path.join("html", language.id, relativePath),
                contents: Buffer.from(newContent, 'utf8')
            }));
        });

        // Special case - put the original in an 'en' directory to simplify referring code
        this.queue(new vinyl({
            path: path.join("html/en/", relativePath),
            contents: file.contents
        }));
    });
};

// Generate localized versions of HTML files
// Check for cooresponding localized json file in i18n
// Generate new version of the HTML file in dist/html/<language_id>/<path>
const generateHtmlLoc = () => {
    return gulp.src(htmlFilesPatterns)
        .pipe(generateLocalizedHtmlFiles())
        .pipe(gulp.dest('dist'));
};

const generateLocalizedJsonSchemaFiles = () => {
    return es.through(function (file) {
        let jsonTree = JSON.parse(file.contents.toString());
        languages.map((language) => {
            let stringTable = {};
            // Try to open i18n file for this file
            let relativePath = removePathPrefix(file.path, file.cwd);
            let locFile = path.join("./i18n", language.folderName, relativePath + ".i18n.json");
            if (fs.existsSync(locFile)) {
                stringTable = JSON.parse(fs.readFileSync(locFile).toString());
            }
            // Entire file is scanned and modified, then serialized for that language.
            // Even if no translations are available, we still write new files to dist/html/...
            if (stringTable[keyPrefix + path]) {
                let keyPrefix = relativePath + ".";
                let descriptionCallback = (path, value, parent) => {
                    parent.description = stringTable[keyPrefix + path];
                };
                traverseJson(jsonTree, descriptionCallback, "");
            }
            let newContent = JSON.stringify(jsonTree, null, '\t');
            this.queue(new vinyl({
                path: path.join("schema", language.id, relativePath),
                contents: Buffer.from(newContent, 'utf8')
            }));
        });
    });
};

// Generate localized versions of JSON schema files
// Check for cooresponding localized json file in i18n
// Generate new version of the JSON schema file in dist/schema/<language_id>/<path>
const generateJsonSchemaLoc = () => {
    return gulp.src(jsonSchemaFilesPatterns)
        .pipe(generateLocalizedJsonSchemaFiles())
        .pipe(gulp.dest('dist'));
};

gulp.task('translations-generate', gulp.series(generatedSrcLocBundle, generatedAdditionalLocFiles, generateHtmlLoc, generateJsonSchemaLoc));


// ****************************
// Command: generate-native-strings
// The following is used to generate nativeStrings.ts and localized_string_ids.h from ./src/nativeStrings.json
// If adding localized strings to the native side, start by adding it to nativeStrings.json and use this to generate the others.
// ****************************

// A gulp task to parse ./src/nativeStrings.json and generate nativeStrings.ts, and localized_string_ids.h
gulp.task("generate-native-strings", (done) => {
    const stringTable = jsonc.parse(fs.readFileSync('./src/nativeStrings.json').toString());

    let nativeEnumContent = ""
    let nativeStringTableContent = "";
    let typeScriptSwitchContent = "";

    let stringIndex = 1;
    for (let property in stringTable) {
        let stringName = property;
        let stringValue = stringTable[property];
        
        // Add to native enum
        nativeEnumContent += `    ${property} = ${stringIndex},\n`;
        
        // Add to native string table
        nativeStringTableContent += `    ${JSON.stringify(stringTable[property])},\n`;

        // Add to TypeScript switch
        // Skip empty strings, which can be used to prevent enum/index reordering
        if (stringTable[property] != "") {
            typeScriptSwitchContent += `        case ${stringIndex}:\n            message = localize(${JSON.stringify(property)}, ${JSON.stringify(stringTable[property])}`;
        }
        let argIndex = 0;
        for (;;) {
            if (!stringValue.includes(`{${argIndex}}`)) {
                break;
            }
            typeScriptSwitchContent += `, stringArgs[${argIndex}]`;
            ++argIndex;
        }
        typeScriptSwitchContent += ");\n            break;\n";
        ++stringIndex;
    };

    let typeScriptContent = `/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

// ****** This file is generated from nativeStrings.json.  Do not edit this file directly. ******

'use strict';

import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export function lookupString(stringId: number, stringArgs?: string[]): string {
    let message: string;
    switch (stringId) {
        case 0:
            message = "";   // Special case for blank string
            break;
${typeScriptSwitchContent}
        default:
            console.assert(\"Unrecognized string ID\");
            break;
    }
    return message;
}
`;
    console.log("Writing file: ./src/nativeStrings.ts");
    fs.writeFileSync("./src/nativeStrings.ts", typeScriptContent, 'utf8');

    let nativeContents = `/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

// ****** This file is generated from nativeStrings.json.  Do not edit this file directly. ******

#pragma once

enum class localized_string_id
{
    blank = 0,
${nativeEnumContent}};

inline static const char* localizable_strings[] = {
    "",
${nativeStringTableContent}};
`;

    console.log("Writing file: localized_string_ids.h -- If changed, copy to VS repo: src/vc/designtime/vscode/Common/");
    fs.writeFileSync("localized_string_ids.h", nativeContents, 'utf8');
    done();
});
