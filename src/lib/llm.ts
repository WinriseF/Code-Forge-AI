import { AIProviderConfig } from "@/types/model";

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  reasoning?: string; // 思考内容
}

/**
 * 通用的 SSE 流式请求处理函数
 */
export async function streamChatCompletion(
  messages: ChatMessage[],
  config: AIProviderConfig,
  // 2. 修改回调签名：同时返回 content 和 reasoning
  onChunk: (contentDelta: string, reasoningDelta: string) => void,
  onError: (err: string) => void,
  onFinish: () => void
) {
  try {
    if (!config.apiKey) {
      throw new Error("API Key not configured. Please go to Settings.");
    }

    const body = {
      model: config.modelId,
      messages: messages,
      stream: true,
      temperature: config.temperature,
    };

    const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; 

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        
        const dataStr = trimmed.replace("data: ", "");
        if (dataStr === "[DONE]") break;

        try {
          const json = JSON.parse(dataStr);
          const delta = json.choices?.[0]?.delta;
          
          if (delta) {
            // DeepSeek/SiliconFlow 的思考内容通常在 reasoning_content 字段
            const contentDelta = delta.content || "";
            const reasoningDelta = delta.reasoning_content || "";
            
            if (contentDelta || reasoningDelta) {
                onChunk(contentDelta, reasoningDelta);
            }
          }
        } catch (e) {
          console.warn("Failed to parse SSE line", e);
        }
      }
    }

    onFinish();

  } catch (error: any) {
    console.error("LLM Request Failed:", error);
    onError(error.message || "Unknown error");
    onFinish();
  }
}