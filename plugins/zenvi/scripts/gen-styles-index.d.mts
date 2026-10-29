export interface LibraryEntry {
  id: string;
  kind: "style" | "technique";
  summary: string;
  pace: string;
  tools: string[];
  aspect: string[];
  categories: string[];
  needs: string[];
  path: string;
  markdown: string;
}
export interface Library {
  entries: LibraryEntry[];
  families: { id: string; path: string; markdown: string }[];
  methods: { id: string; path: string; markdown: string }[];
  errors: string[];
}
export declare const START: string;
export declare const END: string;
export declare function parseFrontMatter(markdown: string): { meta: Record<string, string | string[]>; body: string } | null;
export declare function readLibrary(styles?: string, recipes?: string): Library;
export declare function indexTable(library: Pick<Library, "entries" | "families"> & Partial<Pick<Library, "methods">>): string;
export declare function withIndex(skill: string, table: string): string;
export declare function libraryModule(skill: string, brief: string, library: Pick<Library, "entries" | "families"> & Partial<Pick<Library, "methods">>): string;
export declare function generate(styles?: string, recipes?: string): { errors: string[]; skill: string; module: string };
