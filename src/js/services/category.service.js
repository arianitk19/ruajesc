// Transparent, rules-based smart categories. There is no AI image
// understanding here: each suggestion lists the exact words that produced it,
// taken from the filename, title, tags and OCR text. Users can override any
// suggestion, and their choice is never replaced automatically.
import { fold } from '../utils/text.js';

export const CATEGORY_KEYS = [
  'chats', 'work', 'documents', 'invoices', 'finance', 'travel',
  'shopping', 'social', 'technology', 'education', 'personal', 'other',
];

export const CATEGORY_ICONS = {
  chats: 'message-circle', work: 'briefcase', documents: 'file-text', invoices: 'receipt',
  finance: 'wallet', travel: 'plane', shopping: 'shopping-bag', social: 'users',
  technology: 'code', education: 'graduation-cap', personal: 'heart', other: 'layers',
};

// Keywords are matched as whole folded words (Albanian + English).
// App names carry more weight than ordinary words.
export const RULES = {
  chats: {
    apps: ['whatsapp', 'messenger', 'telegram', 'viber', 'signal', 'imessage', 'messages', 'sms'],
    words: ['typing', 'online', 'seen', 'delivered', 'read', 'shkruan', 'shikuar', 'derguar', 'mesazh', 'mesazhi', 'mesazhe', 'chat', 'reply', 'pergjigju', 'grupi', 'last seen', 'aktiv tani'],
  },
  work: {
    apps: ['slack', 'teams', 'outlook', 'jira', 'trello', 'asana', 'notion', 'zoom', 'meet'],
    words: ['meeting', 'takim', 'takimi', 'deadline', 'afati', 'projekt', 'projekti', 'project', 'client', 'klient', 'klienti', 'raport', 'report', 'agenda', 'detyre', 'detyra', 'task', 'sprint', 'pune', 'zyre', 'office', 'kolege', 'colleague'],
  },
  documents: {
    apps: ['pdf', 'docs', 'word', 'scan', 'skan'],
    words: ['dokument', 'dokumenti', 'document', 'kontrate', 'kontrata', 'contract', 'nenshkrim', 'signature', 'certifikate', 'certificate', 'formular', 'form', 'leternjoftim', 'pasaporte', 'passport', 'neni', 'article', 'page', 'faqe'],
  },
  invoices: {
    apps: ['invoice', 'fature', 'receipt', 'kupon'],
    words: ['fature', 'fatura', 'faturen', 'invoice', 'receipt', 'kupon', 'kuponi', 'totali', 'total', 'tvsh', 'vat', 'nr. fatures', 'subtotal', 'shuma', 'pagese', 'payment due', 'amount due', 'qr', 'nipt', 'nui'],
  },
  finance: {
    apps: ['bank', 'banka', 'paypal', 'revolut', 'wise', 'raiffeisen', 'procredit', 'teb', 'nlb', 'bkt'],
    words: ['eur', 'euro', 'usd', 'balance', 'bilanci', 'gjendja', 'transfer', 'transferim', 'llogari', 'llogaria', 'account', 'iban', 'swift', 'transaksion', 'transaction', 'kredit', 'credit', 'debit', 'kartela', 'card', 'paga', 'salary'],
  },
  travel: {
    apps: ['booking', 'airbnb', 'maps', 'ryanair', 'wizzair', 'uber', 'bolt'],
    words: ['flight', 'fluturim', 'fluturimi', 'boarding', 'gate', 'aeroport', 'airport', 'hotel', 'rezervim', 'rezervimi', 'reservation', 'check-in', 'itinerar', 'itinerary', 'bilete', 'bileta', 'ticket', 'udhetim', 'trip', 'departure', 'nisja', 'arrival', 'arritja'],
  },
  shopping: {
    apps: ['amazon', 'ebay', 'aliexpress', 'temu', 'shein', 'gjirafa50', 'etsy', 'zalando'],
    words: ['cart', 'shporta', 'checkout', 'order', 'porosi', 'porosia', 'shipping', 'dergesa', 'transporti', 'delivery', 'price', 'cmimi', 'zbritje', 'discount', 'sale', 'blej', 'buy', 'add to cart', 'stock'],
  },
  social: {
    apps: ['instagram', 'facebook', 'tiktok', 'twitter', 'x.com', 'snapchat', 'linkedin', 'reddit', 'youtube', 'threads', 'pinterest'],
    words: ['likes', 'pelqime', 'followers', 'ndjekes', 'following', 'comments', 'komente', 'share', 'shperndaj', 'story', 'reel', 'post', 'postim', 'retweet', 'subscribe'],
  },
  technology: {
    apps: ['github', 'gitlab', 'vscode', 'code', 'terminal', 'stackoverflow', 'chrome', 'console', 'devtools'],
    words: ['error', 'gabim', 'exception', 'function', 'const', 'import', 'npm', 'git', 'commit', 'server', 'api', 'http', 'https', 'localhost', 'database', 'undefined', 'null', 'stack', 'debug', 'install', 'settings', 'cilesimet', 'wifi', 'bluetooth', 'update'],
  },
  education: {
    apps: ['moodle', 'classroom', 'coursera', 'udemy', 'duolingo', 'khan'],
    words: ['ligjerata', 'ligjerate', 'lecture', 'provim', 'provimi', 'exam', 'detyre shtepie', 'homework', 'kuiz', 'quiz', 'universitet', 'university', 'fakultet', 'faculty', 'student', 'profesor', 'professor', 'semester', 'semestri', 'nota', 'grade', 'lenda', 'course', 'kursi', 'mesim', 'lesson', 'syllabus'],
  },
  personal: {
    apps: ['photos', 'camera', 'health', 'shendeti', 'calendar', 'kalendari', 'notes', 'shenime'],
    words: ['ditelindja', 'birthday', 'familja', 'family', 'recete', 'recipe', 'kujtese', 'reminder', 'shenim', 'note', 'idea', 'ide', 'qellim', 'goal', 'dashuri', 'love', 'shtepi', 'home'],
  },
};

function wordsOf(text) {
  const cleaned = fold(text)
    .replace(/[^\p{L}\p{N}.-]+/gu, ' ')
    .replace(/[.-]+(?=\s|$)/g, ' ')
    .replace(/(^|\s)[.-]+/g, ' ');
  return ` ${cleaned.replace(/\s+/g, ' ')} `;
}

function containsWord(haystack, word) {
  return haystack.includes(` ${word} `) || (word.includes(' ') && haystack.includes(word));
}

/**
 * @param {{original_filename?:string,title?:string,ocr_text?:string,tags?:{name:string}[]}} item
 * @returns {{category: string, evidence: {source: string, word: string}[], score: number}}
 */
export function categorize(item) {
  const sources = {
    filename: wordsOf(String(item.original_filename ?? '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_.]+/g, ' ')),
    title: wordsOf(item.title),
    tags: wordsOf((item.tags ?? []).map((t) => t.name ?? t).join(' ')),
    ocr: wordsOf(String(item.ocr_text ?? '').slice(0, 20000)),
  };
  const weights = { filename: 3, title: 3, tags: 4, ocr: 1 };

  let best = { category: 'other', evidence: [], score: 0 };
  for (const [category, rule] of Object.entries(RULES)) {
    let score = 0;
    const evidence = [];
    const seen = new Set();
    for (const [source, text] of Object.entries(sources)) {
      for (const word of rule.apps) {
        if (containsWord(text, word) && !seen.has(word)) {
          seen.add(word);
          score += weights[source] * 2;
          evidence.push({ source, word });
        }
      }
      for (const word of rule.words) {
        if (containsWord(text, word) && !seen.has(word)) {
          seen.add(word);
          score += weights[source];
          evidence.push({ source, word });
        }
      }
    }
    if (score > best.score) best = { category, evidence: evidence.slice(0, 6), score };
  }
  // Require more than one weak OCR hit before committing to a category.
  if (best.score < 2) return { category: 'other', evidence: [], score: best.score };
  return best;
}

/** Applies a suggestion unless the user set the category themselves. */
export function autoCategoryPatch(item) {
  if (item.category_source === 'user') return null;
  const result = categorize(item);
  if (result.category === item.category && item.category_source === 'auto') return null;
  return { category: result.category, category_source: 'auto', category_evidence: result.evidence };
}
