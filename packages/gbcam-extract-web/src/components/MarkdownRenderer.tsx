import { useMemo } from "react";

/**
 * Parse markdown into simple React elements
 * Supports: headings, paragraphs, lists, bold, italic, links, code blocks, images
 */
export function useMarkdownRenderer(markdown: string) {
  return useMemo(() => {
    const lines = markdown.split("\n");
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Heading 2 (##)
      if (line.startsWith("## ")) {
        const text = line.substring(3).trim();
        elements.push(
          <h2
            key={`h2-${i}`}
            className="text-lg font-bold mt-4 mb-2 text-gray-100"
          >
            {renderInlineMarkdown(text)}
          </h2>,
        );
        i++;
        continue;
      }

      // Heading 3 (###)
      if (line.startsWith("### ")) {
        const text = line.substring(4).trim();
        elements.push(
          <h3
            key={`h3-${i}`}
            className="text-base font-semibold mt-3 mb-2 text-gray-200"
          >
            {renderInlineMarkdown(text)}
          </h3>,
        );
        i++;
        continue;
      }

      // Code block (```)
      if (line.trim().startsWith("```")) {
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith("```")) {
          codeLines.push(lines[i]);
          i++;
        }
        elements.push(
          <pre
            key={`code-${i}`}
            className="bg-gray-800 p-3 rounded mb-3 overflow-x-auto text-xs"
          >
            <code className="text-gray-300">{codeLines.join("\n")}</code>
          </pre>,
        );
        i++;
        continue;
      }

      // Unordered list (-)
      if (line.trim().startsWith("- ")) {
        const listItems: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith("- ")) {
          listItems.push(lines[i].trim().substring(2).trim());
          i++;
        }
        elements.push(
          <ul
            key={`ul-${i}`}
            className="list-disc list-inside mb-3 space-y-1 text-gray-300"
          >
            {listItems.map((item, idx) => (
              <li key={`li-${idx}`}>{renderInlineMarkdown(item)}</li>
            ))}
          </ul>,
        );
        continue;
      }

      // Numbered list (1., 2., etc)
      if (/^\d+\.\s/.test(line.trim())) {
        const listItems: string[] = [];
        while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
          const match = lines[i].trim().match(/^\d+\.\s+(.*)/);
          if (match) {
            listItems.push(match[1]);
          }
          i++;
        }
        elements.push(
          <ol
            key={`ol-${i}`}
            className="list-decimal list-inside mb-3 space-y-1 text-gray-300"
          >
            {listItems.map((item, idx) => (
              <li key={`ol-li-${idx}`}>{renderInlineMarkdown(item)}</li>
            ))}
          </ol>,
        );
        continue;
      }

      // Image
      if (line.includes("![")) {
        const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/;
        const match = line.match(imgRegex);
        if (match) {
          const alt = match[1];
          const src = match[2];
          elements.push(
            <img
              key={`img-${i}`}
              src={src}
              alt={alt}
              className="max-w-full h-auto rounded mb-3"
            />,
          );
          i++;
          continue;
        }
      }

      // Empty line (paragraph break)
      if (line.trim() === "") {
        i++;
        continue;
      }

      // Regular paragraph
      if (line.trim().length > 0) {
        elements.push(
          <p key={`p-${i}`} className="mb-3 text-gray-300 leading-relaxed">
            {renderInlineMarkdown(line)}
          </p>,
        );
        i++;
        continue;
      }

      i++;
    }

    return elements;
  }, [markdown]);
}

/**
 * Render inline markdown: bold, italic, code, links
 */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let current = text;
  let index = 0;

  // Patterns to match: **bold**, *italic*, `code`, [link](url)
  const patterns = [
    { regex: /\*\*([^*]+)\*\*/, tag: "strong", class: "font-semibold" },
    { regex: /\*([^*]+)\*/, tag: "em", class: "italic" },
    {
      regex: /`([^`]+)`/,
      tag: "code",
      class: "bg-gray-700 px-1.5 py-0.5 rounded text-sm",
    },
    { regex: /\[([^\]]+)\]\(([^)]+)\)/, tag: "a", isLink: true },
  ];

  while (current.length > 0) {
    let foundMatch = false;

    for (const pattern of patterns) {
      const match = current.match(pattern.regex);
      if (match) {
        // Add text before match
        const beforeText = current.substring(0, match.index);
        if (beforeText) {
          parts.push(beforeText);
        }

        // Add matched element
        if (pattern.isLink) {
          const linkText = match[1];
          const linkUrl = match[2];
          const isExternal =
            linkUrl.startsWith("http://") ||
            linkUrl.startsWith("https://") ||
            linkUrl.startsWith("//");

          parts.push(
            <a
              key={`link-${index}`}
              href={linkUrl}
              className="text-blue-400 hover:text-blue-300 underline"
              target={isExternal ? "_blank" : undefined}
              rel={isExternal ? "noopener noreferrer" : undefined}
            >
              {linkText}
            </a>,
          );
        } else {
          const content = match[1];
          parts.push(
            <span key={`inline-${index}`} className={pattern.class}>
              {content}
            </span>,
          );
        }

        // Continue with remaining text
        current = current.substring(match.index! + match[0].length);
        foundMatch = true;
        index++;
        break;
      }
    }

    if (!foundMatch) {
      // No more patterns found, add remaining text
      parts.push(current);
      break;
    }
  }

  return parts.length === 0 ? [text] : parts;
}

/**
 * Component that renders markdown
 */
export function MarkdownRenderer({ markdown }: { markdown: string }) {
  const elements = useMarkdownRenderer(markdown);
  return <div className="space-y-2">{elements}</div>;
}
