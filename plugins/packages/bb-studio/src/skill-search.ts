export interface SearchableSkill {
  name: string;
  description: string;
  body: string;
}

export interface SkillHit {
  name: string;
  description: string;
  score: number;
  fields: ("title" | "description" | "body")[];
  snippet: string;
}

const STOPWORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "do", "for", "from", "how", "i", "in", "is", "it", "my", "of", "on", "or", "the", "to", "what", "when", "with"]);
const WEIGHTS = { title: 4, description: 2, body: 1 } as const;
const K1 = 1.2;
const B = 0.75;

export function skillTokens(text: string): string[] {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

const matches = (token: string, term: string) => token === term || (term.length >= 3 && token.startsWith(term));

function snippetOf(body: string, terms: readonly string[]): string {
  const lower = body.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.search(new RegExp(`(^|[^a-z0-9])${term.replace(/[^a-z0-9]/g, "")}`));
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  if (at < 0) return "";
  const start = Math.max(0, at - 60);
  const text = body.slice(start, start + 200).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${text}${start + 200 < body.length ? "…" : ""}`;
}

export function rankSkills(skills: readonly SearchableSkill[], query: string, limit = 10): SkillHit[] {
  const terms = [...new Set(skillTokens(query))];
  if (!terms.length || !skills.length) return [];
  const docs = skills.map((skill) => ({
    skill,
    fields: {
      title: skillTokens(skill.name),
      description: skillTokens(skill.description),
      body: skillTokens(skill.body),
    },
  }));
  const average = (field: keyof typeof WEIGHTS) => Math.max(1, docs.reduce((sum, doc) => sum + doc.fields[field].length, 0) / docs.length);
  const averages = { title: average("title"), description: average("description"), body: average("body") };
  const idf = new Map(terms.map((term) => {
    const holders = docs.filter((doc) => Object.values(doc.fields).some((tokens) => tokens.some((token) => matches(token, term)))).length;
    return [term, Math.log(1 + (docs.length - holders + 0.5) / (holders + 0.5))];
  }));
  const phrase = query.trim().toLowerCase().replace(/\s+/g, " ");
  const hits: SkillHit[] = [];
  for (const doc of docs) {
    let score = 0;
    let matched = 0;
    const fields = new Set<SkillHit["fields"][number]>();
    for (const term of terms) {
      let termScore = 0;
      for (const field of ["title", "description", "body"] as const) {
        const tokens = doc.fields[field];
        const tf = tokens.filter((token) => matches(token, term)).length;
        if (!tf) continue;
        fields.add(field);
        termScore += WEIGHTS[field] * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * tokens.length / averages[field]));
      }
      if (termScore > 0) matched += 1;
      score += idf.get(term)! * termScore;
    }
    if (!matched) continue;
    if (phrase.length > 2 && terms.length > 1) {
      if (doc.skill.name.replace(/-/g, " ").includes(phrase)) score += 3;
      if (doc.skill.description.toLowerCase().includes(phrase)) score += 2;
      if (doc.skill.body.toLowerCase().includes(phrase)) score += 1;
    }
    score *= 0.5 + 0.5 * (matched / terms.length);
    hits.push({
      name: doc.skill.name,
      description: doc.skill.description,
      score: Math.round(score * 1000) / 1000,
      fields: (["title", "description", "body"] as const).filter((field) => fields.has(field)),
      snippet: fields.has("body") ? snippetOf(doc.skill.body, terms) : "",
    });
  }
  return hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, Math.max(1, limit));
}
