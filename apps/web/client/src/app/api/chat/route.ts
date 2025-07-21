import { createClient as createTRPCClient } from '@/trpc/request-server';
import { trackEvent } from '@/utils/analytics/server';
import { createClient as createSupabaseClient } from '@/utils/supabase/request-server';
import {
    askToolSet,
    buildToolSet,
    CREATE_FILE_TOOL_NAME,
    EDIT_FILE_TOOL_NAME,
    getAskModeSystemPrompt,
    getCreatePageSystemPrompt,
    getSystemPrompt,
    initModel,
    LIST_FILES_TOOL_NAME,
    READ_FILES_TOOL_NAME,
} from '@onlook/ai';
import { ChatType, CLAUDE_MODELS, LLMProvider, type Usage, UsageType } from '@onlook/models';
import { generateObject, NoSuchToolError, streamText, tool } from 'ai';
import { type NextRequest } from 'next/server';
import { tools, ToolsOptionsProvider } from './tools';

export async function POST(req: NextRequest) {
    try {
        const user = await getSupabaseUser(req);
        if (!user) {
            return new Response(
                JSON.stringify({
                    error: 'Unauthorized, no user found. Please login again.',
                    code: 401,
                }),
                {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' },
                },
            );
        }

        const usageCheckResult = await checkMessageLimit(req);
        if (usageCheckResult.exceeded) {
            trackEvent({
                distinctId: user.id,
                event: 'message_limit_exceeded',
                properties: {
                    usage: usageCheckResult.usage,
                },
            });
            return new Response(
                JSON.stringify({
                    error: 'Message limit exceeded. Please upgrade to a paid plan.',
                    code: 402,
                    usage: usageCheckResult.usage,
                }),
                {
                    status: 402,
                    headers: { 'Content-Type': 'application/json' },
                },
            );
        }

        return streamResponse(req);
    } catch (error: any) {
        console.error('Error in chat', error);
        return new Response(
            JSON.stringify({
                error: 'Internal Server Error',
                code: 500,
                details: error instanceof Error ? error.message : String(error),
            }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            },
        );
    }
}

export const checkMessageLimit = async (
    req: NextRequest,
): Promise<{
    exceeded: boolean;
    usage: Usage;
}> => {
    const { api } = await createTRPCClient(req);
    const usage = await api.usage.get();

    const dailyUsage = usage.daily;
    const dailyExceeded = dailyUsage.usageCount >= dailyUsage.limitCount;
    if (dailyExceeded) {
        return {
            exceeded: true,
            usage: dailyUsage,
        };
    }

    const monthlyUsage = usage.monthly;
    const monthlyExceeded = monthlyUsage.usageCount >= monthlyUsage.limitCount;
    if (monthlyExceeded) {
        return {
            exceeded: true,
            usage: monthlyUsage,
        };
    }

    return {
        exceeded: false,
        usage: monthlyUsage,
    };
};

export const getSupabaseUser = async (request: NextRequest) => {
    const supabase = await createSupabaseClient(request);
    const {
        data: { user },
    } = await supabase.auth.getUser();
    return user;
};

export const streamResponse = async (req: NextRequest) => {
    const { messages, maxSteps, chatType, projectId } = await req.json();
    const { model, providerOptions } = await initModel({
        provider: LLMProvider.ANTHROPIC,
        model: CLAUDE_MODELS.SONNET_4,
    });

    let systemPrompt: string;
    switch (chatType) {
        case ChatType.CREATE:
            systemPrompt = getCreatePageSystemPrompt();
            break;
        case ChatType.ASK:
            systemPrompt = getAskModeSystemPrompt();
            break;
        case ChatType.EDIT:
        default:
            systemPrompt = getSystemPrompt();
            break;
    }

    const { api } = await createTRPCClient(req);
    const project = await api.project.get({ projectId });
    if (!project) {
        throw new Error('Project not found');
    }

    const toolSet = chatType === ChatType.ASK ? askToolSet : buildToolSet;
    if (LIST_FILES_TOOL_NAME in toolSet) {
        toolSet[LIST_FILES_TOOL_NAME] = tool({
            ...toolSet[LIST_FILES_TOOL_NAME],
            execute: async (args, options) => {
                return tools[LIST_FILES_TOOL_NAME](args, {
                    provider: project.sandbox.id
                        ? ToolsOptionsProvider.CODESANDBOX
                        : ToolsOptionsProvider.UNIMPLEMENTED,
                    codesandbox: project.sandbox?.id
                        ? {
                              sandboxId: project.sandbox.id,
                          }
                        : undefined,
                });
            },
        });
    }
    // if (EDIT_FILE_TOOL_NAME in toolSet) {
    //     toolSet[EDIT_FILE_TOOL_NAME] = tool({
    //         ...toolSet[EDIT_FILE_TOOL_NAME],
    //         execute: async (args, options) => {
    //             return tools[EDIT_FILE_TOOL_NAME](args, (args) => api.code.applyDiff.mutate(args), {
    //                 provider: project.sandbox.id
    //                     ? ToolsOptionsProvider.CODESANDBOX
    //                     : ToolsOptionsProvider.UNIMPLEMENTED,
    //                 codesandbox: project.sandbox?.id
    //                     ? {
    //                           sandboxId: project.sandbox.id,
    //                       }
    //                     : undefined,
    //             });
    //         },
    //     });
    // }
    if (CREATE_FILE_TOOL_NAME in toolSet) {
        toolSet[CREATE_FILE_TOOL_NAME] = tool({
            ...toolSet[CREATE_FILE_TOOL_NAME],
            execute: async (args, options) => {
                return tools[CREATE_FILE_TOOL_NAME](args, {
                    provider: project.sandbox.id
                        ? ToolsOptionsProvider.CODESANDBOX
                        : ToolsOptionsProvider.UNIMPLEMENTED,
                    codesandbox: project.sandbox?.id
                        ? {
                              sandboxId: project.sandbox.id,
                          }
                        : undefined,
                });
            },
        });
    }
    if (READ_FILES_TOOL_NAME in toolSet) {
        toolSet[READ_FILES_TOOL_NAME] = tool({
            ...toolSet[READ_FILES_TOOL_NAME],
            execute: async (args, options) => {
                return tools[READ_FILES_TOOL_NAME](args, {
                    provider: project.sandbox.id
                        ? ToolsOptionsProvider.CODESANDBOX
                        : ToolsOptionsProvider.UNIMPLEMENTED,
                    codesandbox: project.sandbox?.id
                        ? {
                              sandboxId: project.sandbox.id,
                          }
                        : undefined,
                });
            },
        });
    }

    const result = streamText({
        model,
        messages: [
            {
                role: 'system',
                content: systemPrompt,
                providerOptions,
            },
            ...messages,
        ],
        maxSteps,
        tools: toolSet,
        toolCallStreaming: true,
        maxTokens: 64000,
        experimental_repairToolCall: async ({ toolCall, tools, parameterSchema, error }) => {
            if (NoSuchToolError.isInstance(error)) {
                throw new Error(
                    `Tool "${toolCall.toolName}" not found. Available tools: ${Object.keys(tools).join(', ')}`,
                );
            }
            const tool = tools[toolCall.toolName as keyof typeof tools];

            console.warn(
                `Invalid parameter for tool ${toolCall.toolName} with args ${JSON.stringify(toolCall.args)}, attempting to fix`,
            );

            const { object: repairedArgs } = await generateObject({
                model,
                schema: tool?.parameters,
                prompt: [
                    `The model tried to call the tool "${toolCall.toolName}"` +
                        ` with the following arguments:`,
                    JSON.stringify(toolCall.args),
                    `The tool accepts the following schema:`,
                    JSON.stringify(parameterSchema(toolCall)),
                    'Please fix the arguments.',
                ].join('\n'),
            });

            return { ...toolCall, args: JSON.stringify(repairedArgs) };
        },
        onError: (error) => {
            console.error('Error in chat', error);
        },
    });

    try {
        if (chatType === ChatType.EDIT) {
            const user = await getSupabaseUser(req);
            if (!user) {
                throw new Error('User not found');
            }
            await api.usage.increment({
                type: UsageType.MESSAGE,
            });
        }
    } catch (error) {
        console.error('Error in chat usage increment', error);
    }

    return result.toDataStreamResponse();
};
