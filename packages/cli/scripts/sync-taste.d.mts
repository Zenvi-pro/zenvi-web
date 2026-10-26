export declare function tasteModule(markdown: string): string;
export interface DirectorSkill {
  skill: string;
  recipes: { genre: string; markdown: string }[];
}
export declare function readDirector(dir?: string): DirectorSkill;
export declare function directorModule(director: DirectorSkill): string;
