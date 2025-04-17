interface ParsedQuery {
  query?: string;
  type?: string;
  city?: string;
}

export function parseSearchQuery(input: string): ParsedQuery {
  const tokens = input.toLowerCase().split(/\s+/);
  const result: ParsedQuery = {};

  const stopwords = ['in', 'at', 'on', 'to', 'for', 'with', 'and', 'the', 'a', 'of'];

  const knownCities = ['denver', 'new york', 'boston', 'austin', 'nashville', 'portland', 'miami', 'seattle', 'san francisco', 'chicago', 'los angeles', 'bengaluru'];

  const categoryGroups: Record<string, string[]> = {
    restaurants: ['restaurant', 'restaurants', 'steakhouse', 'fine-dining', 'seafood', 'bbq', 'ramen', 'cuban', 'bakery', 'cafe'],
    cafes: ['cafe', 'cafes', 'bakery', 'coffee'],
    desserts: ['dessert', 'desserts', 'bakery']
  };

  const autocorrect: Record<string, string> = {
    restourants: 'restaurants',
    restrants: 'restaurants',
    coffe: 'coffee',
    caffee: 'cafe',
    dessurt: 'dessert',
    nyc: 'new york',
    boson: 'boston'
  };

  let remainingTokens: string[] = [];

  for (let token of tokens) {
    if (autocorrect[token]) {
      token = autocorrect[token];
    }

    if (!result.city && knownCities.includes(token)) {
      result.city = token;
      continue;
    }

    for (const [group, synonyms] of Object.entries(categoryGroups)) {
      if (synonyms.includes(token)) {
        result.type = group;
        break;
      }
    }

    remainingTokens.push(token);
  }

  const queryTokens = remainingTokens.filter(token =>
    token !== result.city &&
    token !== result.type &&
    !stopwords.includes(token)
  );

  result.query = queryTokens.length > 0 ? queryTokens.join(' ') : undefined;
  return result;
}