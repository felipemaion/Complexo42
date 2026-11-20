import { buttonClass, inputClass, labelClass } from "@/modules/ui";
import type { InstanceConfig } from "@/modules/instance";
import type { ChatMessage } from "../types";

type ChatPanelProps = {
  readonly teamId: string;
  readonly messages: readonly ChatMessage[];
  readonly text: InstanceConfig["teamChat"];
  readonly postAction: (formData: FormData) => void | Promise<void>;
};

export function ChatPanel({
  teamId,
  messages,
  text,
  postAction,
}: ChatPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-ink-muted">{text.privacyNote}</p>

      {messages.length === 0 ? (
        <p className="text-base text-ink-muted">{text.empty}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {messages.map((message) => {
            const containerClass = message.isMine
              ? "ml-8 bg-soft"
              : "mr-8 bg-surface border border-line";

            const timeStr = new Date(message.createdAt).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <li
                key={message.messageId}
                className={`${containerClass} rounded-2xl p-3 flex flex-col gap-1`}
              >
                <div className="flex justify-between items-center text-base">
                  <span className="font-bold">
                    {message.isMine ? text.you : message.authorName}
                  </span>
                  <time className="text-ink-muted">{timeStr}</time>
                </div>
                <p className="whitespace-pre-line break-words text-base">{message.body}</p>
              </li>
            );
          })}
        </ol>
      )}

      <form action={postAction} className="flex flex-col gap-3">
        <input type="hidden" name="teamId" value={teamId} />
        <label htmlFor="collab-body" className={labelClass}>
          {text.messageLabel}
        </label>
        <textarea
          id="collab-body"
          name="body"
          required
          maxLength={1000}
          className={`${inputClass} min-h-24`}
        />
        <div>
          <button type="submit" className={buttonClass("primary")}>
            {text.sendButton}
          </button>
        </div>
      </form>
    </div>
  );
}
