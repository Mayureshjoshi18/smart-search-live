// src/types/string-similarity.d.ts
declare module 'string-similarity' {
  export type Rating = {
    target: string;
    rating: number;
  };

  export function compareTwoStrings(str1: string, str2: string): number;

  export function findBestMatch(
    mainString: string,
    targetStrings: string[]
  ): {
    ratings: Rating[];
    bestMatch: Rating;
    bestMatchIndex: number;
  };
}

