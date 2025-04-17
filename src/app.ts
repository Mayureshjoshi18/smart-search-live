import express, { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { parseSearchQuery } from './utils/queryParser';
import stringSimilarity from 'string-similarity';
import rateLimit from 'express-rate-limit';
import timeout from 'connect-timeout';

const app = express();
const PORT = 3000;

let db: Database<sqlite3.Database, sqlite3.Statement>;

app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use(timeout('10s'));
app.use((req, res, next) => {
  if (!(req as any).timedout) next();
});

(async () => {
  db = await open({ filename: './database.sqlite', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    location TEXT,
    city TEXT,
    average_rating REAL DEFAULT 0.0,
    review_count INTEGER DEFAULT 0
  );`);
})();

const typeCategoryMap: Record<string, string[]> = {
  restaurant: ['restaurant', 'cafe', 'brunch', 'steakhouse', 'fine-dining', 'seafood', 'bbq', 'ramen', 'cuban'],
  cafe: ['cafe'],
  brunch: ['brunch'],
  steakhouse: ['steakhouse'],
  bakery: ['bakery'],
  dessert: ['dessert'],
  fastfood: ['fast-food'],
  sushi: ['sushi']
};

const normalizeCategory = (t: string) =>
  t.toLowerCase().endsWith('s') ? t.toLowerCase().slice(0, -1) : t.toLowerCase();


async function searchByFilters({ query, type, city, ratingMin, reviewCountMin, offset, pageSize }: any) {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (query) {
    conditions.push(`LOWER(name) LIKE ?`);
    params.push(`%${query.toLowerCase()}%`);
  }

  if (city) {
    conditions.push(`LOWER(city) = ?`);
    params.push(city.toLowerCase());
  }

  if (type) {
    const expandedTypes = typeCategoryMap[type] || [type];
    const placeholders = expandedTypes.map(() => '?').join(', ');
    conditions.push(`LOWER(type) IN (${placeholders})`);
    params.push(...expandedTypes);
  }

  if (ratingMin > 0) {
    conditions.push(`average_rating >= ?`);
    params.push(ratingMin);
  }

  if (reviewCountMin > 0) {
    conditions.push(`review_count >= ?`);
    params.push(reviewCountMin);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const results = await db.all(`SELECT * FROM subjects ${whereClause} LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  const totalRow = await db.get<{ count: number }>(`SELECT COUNT(*) as count FROM subjects ${whereClause}`, params);

  return { results, total: totalRow?.count || 0 };
}

async function searchByCity(city: string) {
  return await db.all(`SELECT * FROM subjects WHERE LOWER(city) = ?`, [city.toLowerCase()]);
}

async function searchByName(query: string, type?: string, city?: string, pageSize = 10) {
  let allSubjects: any[] = city
    ? await db.all(`SELECT * FROM subjects WHERE LOWER(city) = ?`, [city.toLowerCase()])
    : await db.all(`SELECT * FROM subjects`);

  if (!query) return [];

  const exactMatch = allSubjects.find(s => s.name.toLowerCase() === query.toLowerCase());
  if (exactMatch) {
    return [exactMatch];
  }

  const nameMatches = stringSimilarity.findBestMatch(query.toLowerCase(), allSubjects.map(s => s.name.toLowerCase())).ratings;

  const typeMatches = type
    ? stringSimilarity.findBestMatch(type.toLowerCase(), allSubjects.map(s => s.type.toLowerCase())).ratings
    : [];

  const scoreMap: Record<number, number> = {};

  const applyScores = (matches: typeof nameMatches, key: keyof typeof allSubjects[0]) => {
    matches.forEach(match => {
      if (match.rating > 0.4) {
        const subject = allSubjects.find(s => (s[key] as string).toLowerCase() === match.target);
        if (subject) {
          scoreMap[subject.id] = (scoreMap[subject.id] || 0) + match.rating;
        }
      }
    });
  };

  applyScores(nameMatches, 'name');
  applyScores(typeMatches, 'type');

  const sortedIds = Object.entries(scoreMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, pageSize)
    .map(([id]) => parseInt(id));

  const results = allSubjects.filter(s => sortedIds.includes(s.id));
  return results;
}

const handleSearch = (req: Request, res: Response, next: NextFunction): void => {
  (async () => {
    const isPost = req.method === 'POST';
    const source = isPost ? req.body : req.query;

    const userQuery = (source.q as string) || '';
    const page = parseInt(source.page as string) || 1;
    const pageSize = parseInt(source.pageSize as string) || 10;
    const offset = (page - 1) * pageSize;

    const ratingMin = parseFloat(source.ratingMin as string) || 0;
    const reviewCountMin = parseInt(source.reviewCountMin as string) || 0;
    let typeParam = source.type as string;
    const cityParam = source.city as string;

    const parsed = parseSearchQuery(userQuery);
    let { query = '', type: parsedType, city: parsedCity } = parsed;

    let type = typeParam || parsedType;
    let city = cityParam || parsedCity;

    // Correct city name if misspelled
    // Try to correct city if nothing was parsed
  if (!city) {
    const rawWords = userQuery.toLowerCase().split(/\s+/);
    const cityRows: { city: string }[] = await db.all(`SELECT DISTINCT city FROM subjects`);
    const validCities = cityRows.map(row => row.city.toLowerCase());

    const match = stringSimilarity.findBestMatch(
      rawWords.join(' '),
      validCities
    );

    const bestMatchCity = cityRows.find(row => row.city.toLowerCase() === match.bestMatch.target)?.city;

    if (match.bestMatch.rating > 0.7 && bestMatchCity) {
      city = bestMatchCity;
      console.log(`Corrected city from query text: ${bestMatchCity}`);
    } else {
      for (const word of rawWords) {
        const wordMatch = stringSimilarity.findBestMatch(word, validCities);
        const candidate = cityRows.find(row => row.city.toLowerCase() === wordMatch.bestMatch.target)?.city;
        if (wordMatch.bestMatch.rating > 0.7 && candidate) {
          city = candidate;
          console.log(`Corrected city from word '${word}' to '${candidate}'`);
          break;
        }
      }
    }
  }


    if (!type && query) {
      const bestMatch = stringSimilarity.findBestMatch(query.toLowerCase(), Object.keys(typeCategoryMap));
      if (bestMatch.bestMatch.rating > 0) {
        type = bestMatch.bestMatch.target;
      }
    }

    if (type) {
      type = normalizeCategory(type);
    }

    const { results, total } = await searchByFilters({
      query,
      type,
      city,
      ratingMin,
      reviewCountMin,
      offset,
      pageSize
    });

    let finalResults = results;
    let finalTotal = total;

    if (total === 0 && (query || type || city)) {
      finalResults = await searchByName(query, type, city, pageSize);
      finalTotal = finalResults.length;
    }

    const totalPages = Math.ceil(finalTotal / pageSize);
    res.json({
      query: userQuery,
      filters: { type, city, ratingMin, reviewCountMin },
      meta: { total: finalTotal, page, pageSize, totalPages },
      results: finalResults
    });
  })().catch(next);
};

app.get('/search', handleSearch);
app.post('/search', handleSearch);


app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});


const errorHandler: ErrorRequestHandler = (err, req : express.Request, res: express.Response, _next): void => {
  console.error('Internal Server Error:', err);
  if ((req as any).timedout) {
    res.status(503).json({ error: 'Request timed out.' });
  }
  res.status(500).json({ error: 'Something went wrong. Please try again later.' });
};

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});