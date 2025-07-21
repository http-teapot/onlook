import { CodeSandbox, WebSocketSession } from '@codesandbox/sdk';
import type { EDIT_FILE_TOOL_PARAMETERS } from '@onlook/ai';
import type { EditFileResults, ToolsOptionsCodeSandbox } from '../index';
import type { z } from 'zod';
import {
    getBaseName,
    getDirName,
    isImageFile,
    isRootLayoutFile,
    normalizePath,
} from '@onlook/utility';
import { RouterType, type SandboxFile } from '@onlook/models';
import { NEXT_JS_FILE_EXTENSIONS } from '@onlook/constants';
import path from 'path';
import {
    addOidsToAst,
    getAstFromContent,
    getContentFromAst,
    injectPreloadScript,
} from '@onlook/parser';
import { formatContent } from '@/components/store/editor/sandbox/helpers';

export async function editFile(
    args: z.infer<typeof EDIT_FILE_TOOL_PARAMETERS>,
    applyDiff: (args: {
        originalCode: string;
        updateSnippet: string;
        instruction: string;
    }) => Promise<{
        result: string;
        error: string | null;
    }>,
    opt: ToolsOptionsCodeSandbox,
): Promise<EditFileResults> {
    const sdk = new CodeSandbox();
    const sandbox = await sdk.sandboxes.resume(opt.sandboxId);
    const client = await sandbox.connect();

    const exists = await fileExists(client, args.path);
    if (!exists) {
        throw new Error('File does not exist');
    }
    const originalFile = await readFile(client, args.path);

    if (!originalFile) {
        throw new Error('Error reading file');
    }

    if (originalFile.type === 'binary') {
        throw new Error('Binary files are not supported for editing');
    }

    const updatedContent = await applyDiff({
        originalCode: originalFile.content,
        updateSnippet: args.content,
        instruction: args.instruction,
    });
    if (!updatedContent.result) {
        throw new Error('Error applying code change: ' + updatedContent.error);
    }

    const result = await writeFile(client, args.path, updatedContent.result);
    if (!result) {
        throw new Error('Error editing file');
    }
    return 'File edited!';
}

async function fileExists(client: WebSocketSession, path: string): Promise<boolean> {
    const normalizedPath = normalizePath(path);

    try {
        const dirPath = getDirName(normalizedPath);
        const fileName = getBaseName(normalizedPath);
        const dirEntries = await client.fs.readdir(dirPath);
        return dirEntries.some((entry) => entry.name === fileName);
    } catch (error) {
        console.error(`Error checking file existence ${normalizedPath}:`, error);
        return false;
    }
}

async function readFile(client: WebSocketSession, path: string): Promise<SandboxFile | null> {
    const normalizedPath = normalizePath(path);

    try {
        return readRemoteFile(client, normalizedPath);
    } catch (error) {
        console.error(`Error checking file existence ${normalizedPath}:`, error);
        return null;
    }
}

async function readRemoteFile(
    client: WebSocketSession,
    filePath: string,
): Promise<SandboxFile | null> {
    try {
        if (isImageFile(filePath)) {
            console.log('reading image file', filePath);

            const content = await client.fs.readFile(filePath);
            return getFileFromContent(filePath, content);
        } else {
            const content = await client.fs.readTextFile(filePath);
            return getFileFromContent(filePath, content);
        }
    } catch (error) {
        console.error(`Error reading remote file ${filePath}:`, error);
        return null;
    }
}

async function writeFile(client: WebSocketSession, path: string, content: string) {
    const normalizedPath = normalizePath(path);
    let writeContent = content;

    // If the file is a JSX file, we need to process it for mapping before writing
    if (isJsxFile(normalizedPath)) {
        try {
            const { newContent } = await processFileForMapping(
                normalizedPath,
                content,
                // TODO: add router type, probably a legacy thing?
                // this.routerConfig?.type,
            );
            writeContent = newContent;
        } catch (error) {
            console.error(`Error processing file ${normalizedPath}:`, error);
        }
    }

    try {
        await client.fs.writeTextFile(normalizedPath, writeContent);
        return true;
    } catch (error) {
        console.error(`Error writing remote file ${normalizedPath}:`, error);
        return false;
    }
}

async function processFileForMapping(
    filePath: string,
    content: string,
    routerType: RouterType = RouterType.APP,
): Promise<{
    modified: boolean;
    newContent: string;
}> {
    const ast = getAstFromContent(content);
    if (!ast) {
        throw new Error(`Failed to get ast for file ${filePath}`);
    }

    if (isRootLayoutFile(filePath, routerType)) {
        injectPreloadScript(ast);
    }

    const { ast: astWithIds, modified } = addOidsToAst(ast);

    // Format content then create map
    const unformattedContent = await getContentFromAst(astWithIds, content);
    const formattedContent = await formatContent(filePath, unformattedContent);
    const astWithIdsAndFormatted = getAstFromContent(formattedContent);
    const finalAst = astWithIdsAndFormatted ?? astWithIds;
    // const templateNodeMap = createTemplateNodeMap(finalAst, filePath);
    // this.updateMapping(templateNodeMap);
    const newContent = await getContentFromAst(finalAst, content);
    return {
        modified,
        newContent,
    };
}

function getFileFromContent(filePath: string, content: string | Uint8Array) {
    const type = content instanceof Uint8Array ? 'binary' : 'text';
    const newFile: SandboxFile =
        type === 'binary'
            ? {
                  type,
                  path: filePath,
                  content: content as Uint8Array,
              }
            : {
                  type,
                  path: filePath,
                  content: content as string,
              };
    return newFile;
}

function isJsxFile(filePath: string): boolean {
    const extension = path.extname(filePath);
    if (!extension || !NEXT_JS_FILE_EXTENSIONS.includes(extension)) {
        return false;
    }
    return true;
}
