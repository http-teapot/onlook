import { CodeSandbox } from '@codesandbox/sdk';
import type { LIST_FILES_TOOL_PARAMETERS } from '@onlook/ai';
import type { ListFilesResults, ToolsOptionsCodeSandbox } from '../index';
import type { z } from 'zod';

export async function listFiles(
    args: z.infer<typeof LIST_FILES_TOOL_PARAMETERS>,
    opt: ToolsOptionsCodeSandbox,
): Promise<ListFilesResults> {
    const sdk = new CodeSandbox();
    const sandbox = await sdk.sandboxes.resume(opt.sandboxId);
    const client = await sandbox.connect();

    const files = await client.fs.readdir(args.path);

    return files.map((file) => ({
        path: file.name,
        type: file.type,
    }));
}
