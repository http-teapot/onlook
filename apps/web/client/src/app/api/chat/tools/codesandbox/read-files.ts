import { CodeSandbox, WebSocketSession } from '@codesandbox/sdk';
import type { READ_FILES_TOOL_PARAMETERS } from '@onlook/ai';
import type { ToolsOptionsCodeSandbox } from '../index';
import type { z } from 'zod';
import { convertToBase64, isImageFile } from '@onlook/utility';
import type { SandboxFile } from '@onlook/models';
import type { ReadFilesResults } from '../index';

export async function readFiles(
    args: z.infer<typeof READ_FILES_TOOL_PARAMETERS>,
    opt: ToolsOptionsCodeSandbox,
): Promise<ReadFilesResults> {
    const sdk = new CodeSandbox();
    const sandbox = await sdk.sandboxes.resume(opt.sandboxId);
    const client = await sandbox.connect();

    const results: ReadFilesResults = [];
    for (const path of args.paths) {
        const file = await readRemoteFile(client, path);
        if (!file) {
            console.error(`Failed to read file ${path}`);
            continue;
        }
        if (file.type === 'text') {
            results.push({
                path: file.path,
                content: file.content,
                type: file.type,
            });
        } else {
            const base64Content = file.content ? convertToBase64(file.content) : '';
            results.push({
                path: file.path,
                content: base64Content,
                type: file.type,
            });
        }
    }
    return results;
}

async function readRemoteFile(
    client: WebSocketSession,
    filePath: string,
): Promise<SandboxFile | null> {
    try {
        if (isImageFile(filePath)) {
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
