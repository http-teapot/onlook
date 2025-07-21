import {
    CREATE_FILE_TOOL_NAME,
    EDIT_FILE_TOOL_NAME,
    LIST_FILES_TOOL_NAME,
    READ_FILES_TOOL_NAME,
    type CREATE_FILE_TOOL_PARAMETERS,
    type EDIT_FILE_TOOL_PARAMETERS,
    type LIST_FILES_TOOL_PARAMETERS,
    type READ_FILES_TOOL_PARAMETERS,
} from '@onlook/ai';
import type { z } from 'zod';

import * as codesandbox from './codesandbox';

export enum ToolsOptionsProvider {
    CODESANDBOX = 'codesandbox',
    UNIMPLEMENTED = 'unimplemented',
}

export interface ToolsOptionsCodeSandbox {
    sandboxId: string;
}

export interface ToolsOptions {
    provider: ToolsOptionsProvider;
    codesandbox?: ToolsOptionsCodeSandbox;
}

export type ListFilesResults = Array<{
    path: string;
    type: 'file' | 'directory';
}>;

export type ReadFilesResults = {
    path: string;
    content: string;
    type: 'text' | 'binary';
}[];

export type CreateFileResults = string;

export type EditFileResults = string;

async function listFiles(
    args: z.infer<typeof LIST_FILES_TOOL_PARAMETERS>,
    opt: ToolsOptions,
): Promise<ListFilesResults> {
    if (opt.provider === ToolsOptionsProvider.CODESANDBOX && opt.codesandbox) {
        return codesandbox.listFiles(args, opt.codesandbox);
    }

    throw new Error(`Unimplemented provider ${opt.provider} for tool listFiles`);
}

async function readFiles(
    args: z.infer<typeof READ_FILES_TOOL_PARAMETERS>,
    opt: ToolsOptions,
): Promise<ReadFilesResults> {
    if (opt.provider === ToolsOptionsProvider.CODESANDBOX && opt.codesandbox) {
        return codesandbox.readFiles(args, opt.codesandbox);
    }

    throw new Error(`Unimplemented provider ${opt.provider} for tool readFiles`);
}

async function createFile(
    args: z.infer<typeof CREATE_FILE_TOOL_PARAMETERS>,
    opt: ToolsOptions,
): Promise<CreateFileResults> {
    if (opt.provider === ToolsOptionsProvider.CODESANDBOX && opt.codesandbox) {
        return codesandbox.createFile(args, opt.codesandbox);
    }

    throw new Error(`Unimplemented provider ${opt.provider} for tool createFile`);
}

async function editFile(
    args: z.infer<typeof EDIT_FILE_TOOL_PARAMETERS>,
    applyDiff: (args: {
        originalCode: string;
        updateSnippet: string;
        instruction: string;
    }) => Promise<{
        result: string;
        error: string | null;
    }>,
    opt: ToolsOptions,
): Promise<EditFileResults> {
    if (opt.provider === ToolsOptionsProvider.CODESANDBOX && opt.codesandbox) {
        return codesandbox.editFile(args, applyDiff, opt.codesandbox);
    }

    throw new Error(`Unimplemented provider ${opt.provider} for tool editFile`);
}

export const tools = {
    [LIST_FILES_TOOL_NAME]: listFiles,
    [READ_FILES_TOOL_NAME]: readFiles,
    [CREATE_FILE_TOOL_NAME]: createFile,
    [EDIT_FILE_TOOL_NAME]: editFile,
};
