import { CodeSandbox, WebSocketSession } from '@codesandbox/sdk';
import type { CREATE_FILE_TOOL_PARAMETERS } from '@onlook/ai';
import type { CreateFileResults, ToolsOptionsCodeSandbox } from '../index';
import type { z } from 'zod';
import { getBaseName, getDirName, isRootLayoutFile, normalizePath } from '@onlook/utility';
import { RouterType } from '@onlook/models';
import {
    addOidsToAst,
    getAstFromContent,
    getContentFromAst,
    injectPreloadScript,
} from '@onlook/parser';
import { formatContent } from '@/components/store/editor/sandbox/helpers';
import path from 'path';
import { NEXT_JS_FILE_EXTENSIONS } from '@onlook/constants';

export async function createFile(
    args: z.infer<typeof CREATE_FILE_TOOL_PARAMETERS>,
    opt: ToolsOptionsCodeSandbox,
): Promise<CreateFileResults> {
    const sdk = new CodeSandbox();
    const sandbox = await sdk.sandboxes.resume(opt.sandboxId);
    const client = await sandbox.connect();

    const exists = await fileExists(client, args.path);
    if (exists) {
        throw new Error('File already exists');
    }
    const result = await writeFile(client, args.path, args.content);
    if (!result) {
        throw new Error('Error creating file');
    }
    return 'File created';
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

function isJsxFile(filePath: string): boolean {
    const extension = path.extname(filePath);
    if (!extension || !NEXT_JS_FILE_EXTENSIONS.includes(extension)) {
        return false;
    }
    return true;
}
