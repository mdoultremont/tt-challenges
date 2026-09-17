import matter from 'gray-matter';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

export const CHUNK_SIZE = 800;
export const CHUNK_OVERLAP = 100;

export type MarkdownChunk = {
  content: string;
  headingPath: string[];
  startChar: number;
  endChar: number;
  startLine: number;
  endLine: number;
  metadata: Record<string, unknown>;
};

type Heading = { start: number; level: number; title: string; path: string[] };
type HeadingEntry = { level: number; title: string };

const lineNumberAt = (source: string, offset: number) =>
  source.slice(0, Math.max(0, offset)).split('\n').length;

const scanHeadings = (source: string): Heading[] => {
  const headings: Heading[] = [];
  const hierarchy: HeadingEntry[] = [];
  let offset = 0;
  let fence: string | undefined;

  for (const line of source.match(/[^\n]*(?:\n|$)/g) ?? []) {
    const withoutNewline = line.replace(/(?:\r?\n|\r)$/, '');
    const fenceMatch = withoutNewline.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = undefined;
    } else if (!fence) {
      const headingMatch = withoutNewline.match(/^ {0,3}(#{1,4})\s+(.+?)\s*#*\s*$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const title = headingMatch[2].trim();
        while (hierarchy.length > 0 && hierarchy[hierarchy.length - 1].level >= level) {
          hierarchy.pop();
        }
        hierarchy.push({ level, title });
        headings.push({
          start: offset,
          level,
          title,
          path: hierarchy.map((entry) => entry.title),
        });
      }
    }
    offset += line.length;
  }
  return headings;
};

export const splitMarkdown = async (source: string) => {
  const parsed = matter(source);
  const body = parsed.content;
  const bodyOffset = body.length === 0 ? source.length : source.indexOf(body);
  if (bodyOffset < 0) throw new Error('Unable to locate Markdown body in source');
  if (!body.trim()) throw new Error('Document has no Markdown content');

  const headings = scanHeadings(body);
  const sections = [
    ...(headings[0] ? [{ start: 0, end: headings[0].start, path: [] as string[] }] : []),
    ...headings.map((heading, index) => ({
      start: heading.start,
      end: headings[index + 1]?.start ?? body.length,
      path: heading.path,
    })),
  ].filter((section) => section.end > section.start);
  if (!sections.length) sections.push({ start: 0, end: body.length, path: [] });

  const splitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', {
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
    keepSeparator: true,
  });
  const chunks: MarkdownChunk[] = [];

  for (const section of sections) {
    const sectionText = body.slice(section.start, section.end);
    const pieces = await splitter.splitText(sectionText);
    let searchStart = 0;
    for (const content of pieces) {
      const relativeStart = sectionText.indexOf(content, searchStart);
      if (relativeStart < 0) throw new Error('Unable to locate generated chunk in source');
      const startChar = bodyOffset + section.start + relativeStart;
      const endChar = startChar + content.length;
      chunks.push({
        content,
        headingPath: section.path,
        startChar,
        endChar,
        startLine: lineNumberAt(source, startChar),
        endLine: lineNumberAt(source, Math.max(startChar, endChar - 1)),
        metadata: {
          headingPath: section.path,
          frontmatter: parsed.data,
        },
      });
      searchStart = Math.max(relativeStart + 1, relativeStart + content.length - CHUNK_OVERLAP);
    }
  }
  return { chunks, frontmatter: parsed.data };
};
