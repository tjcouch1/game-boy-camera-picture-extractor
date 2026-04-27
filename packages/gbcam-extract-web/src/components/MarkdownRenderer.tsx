import Markdown from "markdown-to-jsx";

/**
 * Component that renders markdown
 */
export function MarkdownRenderer({ markdown }: { markdown: string }) {
  return (
    <div className="prose prose-invert">
      <Markdown
        options={{
          overrides: {
            a: { props: { target: "_blank", rel: "noopener noreferrer" } },
          },
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
