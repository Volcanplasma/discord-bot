require("dotenv").config();

const fs = require("fs");
const path = require("path");
const https = require("https");
const AdmZip = require("adm-zip");
const crypto = require("crypto");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");

/* ================== CONFIG ================== */
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const SUGGEST_CHANNEL_ID = process.env.SUGGEST_CHANNEL_ID || null;

const SITE_URL = "http://plairepoilue.click";
const MC_VERSION = "1.20.1";
const MODPACK_URL =
  "https://www.curseforge.com/minecraft/modpacks/better-mc-forge-bmc4";
const MC_IP = process.env.MC_IP || "play.plairepoilue.click";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Variables manquantes : DISCORD_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}

/* ================== STORAGE (leaderboard) ================== */
const DATA_PATH = path.join(__dirname, "leaderboard.json");

function ensureDataFile() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify({ users: {} }, null, 2));
  }
}
function loadData() {
  ensureDataFile();
  try {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    if (!data.users) data.users = {};
    return data;
  } catch {
    return { users: {} };
  }
}
function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function getUserStats(data, userId) {
  if (!data.users[userId]) {
    data.users[userId] = {
      points: 0,
      quizCorrect: 0,
      mcquizCorrect: 0,
      duelWins: 0,
      duelLosses: 0,
      bombWins: 0,
      bombLosses: 0,
      tttWins: 0,
      tttLosses: 0,
    };
  }
  return data.users[userId];
}
function addPoints(userId, delta) {
  const data = loadData();
  const st = getUserStats(data, userId);
  st.points = Math.max(0, (st.points || 0) + delta);
  saveData(data);
}

/* ================== BAN WORDS ================== */
const BANWORDS_PATH = path.join(__dirname, "banned_words.json");

function ensureBanFile() {
  if (!fs.existsSync(BANWORDS_PATH)) {
    fs.writeFileSync(BANWORDS_PATH, JSON.stringify({ words: [] }, null, 2));
  }
}
function loadBanwords() {
  ensureBanFile();
  try {
    const data = JSON.parse(fs.readFileSync(BANWORDS_PATH, "utf8"));
    return Array.isArray(data.words) ? data.words : [];
  } catch {
    return [];
  }
}
function saveBanwords(words) {
  const clean = [...new Set(words.map((w) => String(w).trim()).filter(Boolean))];
  fs.writeFileSync(BANWORDS_PATH, JSON.stringify({ words: clean }, null, 2));
  return clean;
}
function normalize(t) {
  return String(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/* ================== ZIP UTILS ================== */
function downloadToBuffer(url, maxBytes = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed (${res.statusCode})`));
          res.resume();
          return;
        }
        const chunks = [];
        let total = 0;
        res.on("data", (c) => {
          total += c.length;
          if (total > maxBytes) {
            reject(new Error("File too large"));
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}


function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sanitizeEmojiName(name) {
  let n = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  if (n.length < 2) n = `emoji_${Date.now()}`;
  return n;
}

/* ================== MINI-JEUX BANKS ================== */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const QUIZ_BANK = [
  {
    d: "easy",
    q: "Quelle est la capitale de l'Espagne ?",
    choices: ["Madrid", "Barcelone", "Séville", "Valence"],
    a: 0,
  },
  {
    d: "easy",
    q: "Combien font 7 × 8 ?",
    choices: ["54", "56", "64", "58"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quel océan borde la côte ouest de la France ?",
    choices: ["Océan Indien", "Océan Atlantique", "Océan Arctique", "Océan Pacifique"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quel est l'état de l'eau à 0°C (à pression normale) ?",
    choices: ["Gaz", "Solide", "Plasma", "Liquide"],
    a: 1,
  },
  {
    d: "easy",
    q: "Qui a peint la Joconde ?",
    choices: ["Van Gogh", "Picasso", "Léonard de Vinci", "Monet"],
    a: 2,
  },
  {
    d: "easy",
    q: "Quel est le symbole chimique de l'oxygène ?",
    choices: ["Ox", "O", "Og", "Oy"],
    a: 1,
  },
  {
    d: "easy",
    q: "Combien de côtés a un triangle ?",
    choices: ["2", "3", "4", "5"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quelle planète est surnommée la 'planète rouge' ?",
    choices: ["Vénus", "Mars", "Jupiter", "Mercure"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quelle langue parle-t-on principalement au Brésil ?",
    choices: ["Espagnol", "Portugais", "Français", "Italien"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quel est le plus grand mammifère actuel ?",
    choices: ["Éléphant d'Afrique", "Orque", "Baleine bleue", "Rhinocéros blanc"],
    a: 2,
  },
  {
    d: "easy",
    q: "Combien font 12 + 9 ?",
    choices: ["20", "22", "23", "21"],
    a: 3,
  },
  {
    d: "easy",
    q: "Combien font 15 + 6 ?",
    choices: ["20", "22", "21", "23"],
    a: 2,
  },
  {
    d: "easy",
    q: "Combien font 14 + 7 ?",
    choices: ["20", "22", "23", "21"],
    a: 3,
  },
  {
    d: "easy",
    q: "Combien font 18 + 5 ?",
    choices: ["25", "22", "23", "24"],
    a: 2,
  },
  {
    d: "easy",
    q: "Combien font 20 + 4 ?",
    choices: ["26", "24", "25", "23"],
    a: 1,
  },
  {
    d: "easy",
    q: "Combien font 9 + 9 ?",
    choices: ["17", "18", "19", "20"],
    a: 1,
  },
  {
    d: "easy",
    q: "Combien font 11 + 11 ?",
    choices: ["21", "23", "22", "24"],
    a: 2,
  },
  {
    d: "easy",
    q: "Combien font 16 + 3 ?",
    choices: ["19", "18", "21", "20"],
    a: 0,
  },
  {
    d: "easy",
    q: "Combien font 25 + 2 ?",
    choices: ["27", "29", "26", "28"],
    a: 0,
  },
  {
    d: "easy",
    q: "Combien font 30 + 3 ?",
    choices: ["33", "34", "35", "32"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel est le plus grand océan du monde ?",
    choices: ["Atlantique", "Indien", "Arctique", "Pacifique"],
    a: 3,
  },
  {
    d: "easy",
    q: "Combien de minutes y a-t-il dans une heure ?",
    choices: ["30", "60", "90", "120"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quelle est la couleur obtenue en mélangeant bleu et jaune ?",
    choices: ["Vert", "Violet", "Orange", "Rose"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel instrument mesure la température ?",
    choices: ["Baromètre", "Thermomètre", "Hygromètre", "Sismographe"],
    a: 1,
  },
  {
    d: "easy",
    q: "Combien de continents y a-t-il sur Terre ?",
    choices: ["5", "6", "7", "8"],
    a: 2,
  },
  {
    d: "easy",
    q: "Quel gaz les plantes absorbent-elles principalement ?",
    choices: ["Oxygène", "Azote", "Dioxyde de carbone", "Hélium"],
    a: 2,
  },
  {
    d: "easy",
    q: "Quelle est la monnaie utilisée au Japon ?",
    choices: ["Yen", "Won", "Yuan", "Dollar"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel est le plus long fleuve du monde (réponse scolaire la plus courante) ?",
    choices: ["Nil", "Amazone", "Yangtsé", "Mississippi"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel est l'animal symbole de l'Australie ?",
    choices: ["Panda", "Kangourou", "Lion", "Loup"],
    a: 1,
  },
  {
    d: "easy",
    q: "Combien de jours y a-t-il en février (année non bissextile) ?",
    choices: ["27", "28", "29", "30"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quel est le résultat de 9 × 7 ?",
    choices: ["56", "63", "72", "69"],
    a: 1,
  },
  {
    d: "easy",
    q: "Dans quel pays se trouve Rome ?",
    choices: ["Espagne", "Italie", "Grèce", "Portugal"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quelle est la planète la plus proche du Soleil ?",
    choices: ["Mars", "Mercure", "Vénus", "Terre"],
    a: 1,
  },
  {
    d: "easy",
    q: "Combien de lettres y a-t-il dans l'alphabet latin ?",
    choices: ["24", "25", "26", "27"],
    a: 2,
  },
  {
    d: "easy",
    q: "Quel est le contraire de 'chaud' ?",
    choices: ["Froid", "Sec", "Dur", "Fort"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel organe pompe le sang ?",
    choices: ["Poumon", "Cerveau", "Cœur", "Foie"],
    a: 2,
  },
  {
    d: "easy",
    q: "Quelle forme a une balle de foot (géométrie simplifiée) ?",
    choices: ["Carrée", "Triangulaire", "Ronde", "Rectangulaire"],
    a: 2,
  },
  {
    d: "easy",
    q: "Quelle saison vient après le printemps ?",
    choices: ["Hiver", "Été", "Automne", "Aucune"],
    a: 1,
  },
  {
    d: "easy",
    q: "Combien font 100 ÷ 4 ?",
    choices: ["20", "25", "30", "40"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quel est le symbole chimique du fer ?",
    choices: ["Fe", "F", "Ir", "Fr"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel est le plus petit nombre premier ?",
    choices: ["0", "1", "2", "3"],
    a: 2,
  },
  {
    d: "medium",
    q: "En quelle année l'homme a-t-il marché sur la Lune pour la première fois ?",
    choices: ["1965", "1969", "1972", "1959"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quelle est la formule chimique de l'eau ?",
    choices: ["H2O", "CO2", "O2", "NaCl"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel pays a pour capitale Ottawa ?",
    choices: ["Australie", "Canada", "Irlande", "Suède"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quelle est l'unité de mesure de la puissance électrique ?",
    choices: ["Volt", "Ohm", "Watt", "Ampère"],
    a: 2,
  },
  {
    d: "medium",
    q: "Quel est le plus grand désert chaud du monde ?",
    choices: ["Gobi", "Sahara", "Kalahari", "Atacama"],
    a: 1,
  },
  {
    d: "medium",
    q: "Qui a écrit '1984' ?",
    choices: ["Aldous Huxley", "George Orwell", "Ray Bradbury", "Jules Verne"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel est le résultat de 2^10 ?",
    choices: ["512", "1024", "2048", "256"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quelle est la langue officielle la plus parlée en Afrique (par nombre de pays) ?",
    choices: ["Anglais", "Français", "Arabe", "Portugais"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel métal est liquide à température ambiante (≈20°C) ?",
    choices: ["Mercure", "Aluminium", "Fer", "Cuivre"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quelle est la valeur de π arrondie à 2 décimales ?",
    choices: ["3,12", "3,14", "3,16", "3,18"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel est le nom du détroit entre la France et le Royaume-Uni ?",
    choices: ["Béring", "Gibraltar", "Pas-de-Calais", "Magellan"],
    a: 2,
  },
  {
    d: "medium",
    q: "Quel est l'auteur de 'L'Étranger' ?",
    choices: ["Camus", "Sartre", "Zola", "Hugo"],
    a: 0,
  },
  {
    d: "medium",
    q: "Combien de bits dans un octet ?",
    choices: ["4", "8", "16", "32"],
    a: 1,
  },
  {
    d: "medium",
    q: "Dans un triangle rectangle, quel théorème relie les côtés ?",
    choices: ["Thalès", "Pythagore", "Gauss", "Euler"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel est le plus grand pays du monde par superficie ?",
    choices: ["Canada", "Chine", "Russie", "États-Unis"],
    a: 2,
  },
  {
    d: "medium",
    q: "Quel est l'élément chimique de numéro atomique 6 ?",
    choices: ["Azote", "Oxygène", "Carbone", "Soufre"],
    a: 2,
  },
  {
    d: "medium",
    q: "Quelle ville est surnommée 'la Ville lumière' ?",
    choices: ["Lyon", "Paris", "Marseille", "Bruxelles"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel est le résultat de 45% de 200 ?",
    choices: ["70", "80", "90", "100"],
    a: 2,
  },
  {
    d: "medium",
    q: "Quel est le nom du volcan italien près de Naples ?",
    choices: ["Etna", "Stromboli", "Vésuve", "Santorin"],
    a: 2,
  },
  {
    d: "medium",
    q: "Quel système du corps humain est responsable de la défense contre les infections ?",
    choices: ["Digestif", "Immunitaire", "Respiratoire", "Squelettique"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel est le plus grand os du corps humain ?",
    choices: ["Fémur", "Tibia", "Humérus", "Radius"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quelle est la racine carrée de 144 ?",
    choices: ["10", "11", "12", "13"],
    a: 2,
  },
  {
    d: "medium",
    q: "Quel est le nom de la galaxie qui contient le système solaire ?",
    choices: ["Andromède", "Voie lactée", "Sombrero", "Triangulum"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quelle guerre a opposé les Alliés et l'Axe ?",
    choices: ["Guerre de Cent Ans", "Première GM", "Seconde GM", "Guerre froide"],
    a: 2,
  },
  {
    d: "medium",
    q: "Quelle est la valeur de 3! (factorielle) ?",
    choices: ["3", "6", "9", "12"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel pays a pour devise 'In God We Trust' ?",
    choices: ["Royaume-Uni", "États-Unis", "Canada", "Australie"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel est le point d'ébullition de l'eau à 1 atm ?",
    choices: ["90°C", "100°C", "110°C", "120°C"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel scientifique est associé aux lois du mouvement et à la gravitation ?",
    choices: ["Einstein", "Newton", "Galilée", "Curie"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel est le plus grand organe du corps humain ?",
    choices: ["Cœur", "Foie", "Peau", "Poumon"],
    a: 2,
  },
  {
    d: "medium",
    q: "Quel est le nom de l'équation célèbre liant énergie et masse ?",
    choices: ["F=ma", "E=mc²", "a²+b²=c²", "PV=nRT"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quelle est la capitale de la Turquie ?",
    choices: ["Istanbul", "Ankara", "Izmir", "Bursa"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel est le nombre d'avogadro approximatif ?",
    choices: ["6,02×10^23", "3,14×10^8", "9,81", "1,60×10^-19"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel est le principal gaz de l'air (≈78%) ?",
    choices: ["Oxygène", "Dioxyde de carbone", "Azote", "Argon"],
    a: 2,
  },
  {
    d: "medium",
    q: "Quel est le plus haut sommet du monde ?",
    choices: ["K2", "Everest", "Kilimandjaro", "Mont Blanc"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quelle mer sépare l'Europe de l'Afrique ?",
    choices: ["Mer Noire", "Mer Rouge", "Méditerranée", "Baltique"],
    a: 2,
  },
  {
    d: "medium",
    q: "Quel est l'organe principal de la photosynthèse ?",
    choices: ["Racine", "Tige", "Feuille", "Fleur"],
    a: 2,
  },
  {
    d: "medium",
    q: "Quel pays a inventé le papier (origine historique) ?",
    choices: ["Égypte", "Chine", "Grèce", "Inde"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quelle est la capitale du Canada ?",
    choices: ["Toronto", "Vancouver", "Ottawa", "Montréal"],
    a: 2,
  },
  {
    d: "medium",
    q: "Quel est le résultat de 0,2 × 0,5 ?",
    choices: ["0,1", "0,01", "1", "0,2"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quelle est la dérivée de sin(x) ?",
    choices: ["cos(x)", "-cos(x)", "sin(x)", "-sin(x)"],
    a: 0,
  },
  {
    d: "hard",
    q: "Dans quel pays se trouve la région du Transylvanie ?",
    choices: ["Hongrie", "Roumanie", "Bulgarie", "Slovaquie"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quelle est la constante de Planck (ordre de grandeur) ?",
    choices: ["≈6,6×10^-34 J·s", "≈3,0×10^8 m/s", "≈9,8 m/s²", "≈1,6×10^-19 C"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel est le nom de la mer située au nord de la Turquie ?",
    choices: ["Mer Égée", "Mer Adriatique", "Mer Noire", "Mer Baltique"],
    a: 2,
  },
  {
    d: "hard",
    q: "Quel est le langage de programmation principalement utilisé pour le noyau Linux ?",
    choices: ["Python", "C", "Java", "Rust"],
    a: 1,
  },
  {
    d: "hard",
    q: "En cryptographie, que signifie l'acronyme 'RSA' ?",
    choices: ["Rivest–Shamir–Adleman", "Random Secure Algorithm", "Rapid Security Access", "Routed Signed Authentication"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel est l'animal national de l'Écosse (traditionnel) ?",
    choices: ["Aigle", "Lion", "Licorne", "Dauphin"],
    a: 2,
  },
  {
    d: "hard",
    q: "Quelle est la capitale de la Bolivie (constitutionnelle) ?",
    choices: ["La Paz", "Sucre", "Santa Cruz", "Cochabamba"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel est le nom du paradoxe qui interroge sur un chat à la fois vivant et mort ?",
    choices: ["Paradoxe d'Olbers", "Chat de Schrödinger", "Paradoxe de Fermi", "Paradoxe de Russell"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel est le nombre d'os chez l'adulte humain (valeur courante) ?",
    choices: ["196", "206", "216", "226"],
    a: 1,
  },
  {
    d: "hard",
    q: "Qui a formulé l'équation de Dirac ?",
    choices: ["Einstein", "Dirac", "Feynman", "Bohr"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel est le terme musical pour une accélération progressive du tempo ?",
    choices: ["Rallentando", "Crescendo", "Accelerando", "Legato"],
    a: 2,
  },
  {
    d: "hard",
    q: "Quelle est la valeur de 13² ?",
    choices: ["159", "169", "179", "189"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel pays possède la plus grande superficie forestière (en valeur absolue, généralement) ?",
    choices: ["Brésil", "Russie", "Canada", "États-Unis"],
    a: 1,
  },
  {
    d: "hard",
    q: "Dans quel ensemble se trouve l'élément 'Argon' ?",
    choices: ["Halogènes", "Gaz nobles", "Alcalins", "Lanthanides"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quelle est la somme des angles internes d'un hexagone ?",
    choices: ["540°", "600°", "720°", "900°"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel est le nom du traité (1992) qui a créé l'Union européenne ?",
    choices: ["Traité de Rome", "Traité de Maastricht", "Traité de Versailles", "Traité de Lisbonne"],
    a: 1,
  },
  {
    d: "hard",
    q: "En astronomie, que désigne 'UA' ?",
    choices: ["Unité astronomique", "Ultra-accélération", "Unité angulaire", "Université d'Athènes"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quelle est la vitesse de la lumière dans le vide (approx.) ?",
    choices: ["3,0×10^6 m/s", "3,0×10^7 m/s", "3,0×10^8 m/s", "3,0×10^9 m/s"],
    a: 2,
  },
  {
    d: "hard",
    q: "Quel est l'élément le plus abondant dans l'univers ?",
    choices: ["Oxygène", "Hydrogène", "Carbone", "Fer"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel est le pH d'une solution neutre à 25°C ?",
    choices: ["0", "7", "10", "14"],
    a: 1,
  },
  {
    d: "hard",
    q: "En statistique, que vaut l'espérance d'une variable centrée réduite (N(0,1)) ?",
    choices: ["0", "1", "-1", "2"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel philosophe est l'auteur de 'Critique de la raison pure' ?",
    choices: ["Descartes", "Kant", "Nietzsche", "Spinoza"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quelle est la capitale du Kazakhstan ?",
    choices: ["Almaty", "Astana", "Tachkent", "Bichkek"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel est l'ordre des opérations (priorité) entre multiplication et addition ?",
    choices: ["Addition avant multiplication", "Multiplication avant addition", "Toujours de gauche à droite", "Ça dépend"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel est le nom du processus par lequel une cellule se divise en deux cellules identiques ?",
    choices: ["Méiose", "Mitose", "Osmose", "Fermentation"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quelle unité correspond à 1 volt ?",
    choices: ["Joule par coulomb", "Coulomb par joule", "Watt par ampère", "Newton par mètre"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel est le nom de la couche de l'atmosphère où se trouve l'ozone (majoritairement) ?",
    choices: ["Troposphère", "Stratosphère", "Mésosphère", "Thermosphère"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel est le nom du nombre imaginaire i ?",
    choices: ["√(-1)", "√(1)", "-√(1)", "1/0"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel est le résultat en binaire de 13 (décimal) ?",
    choices: ["1010", "1101", "1110", "1001"],
    a: 1,
  },
];

const MCQUIZ_BANK = [
  {
    d: "easy",
    q: "Quel outil sert principalement à miner la pierre ?",
    choices: ["Hache", "Pioche", "Pelle", "Faux"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quel mob explose quand il s'approche du joueur ?",
    choices: ["Zombie", "Creeper", "Squelette", "Araignée"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quelle dimension est accessible via un portail en obsidienne allumé ?",
    choices: ["L'End", "Le Nether", "Le Monde normal", "L'Aether"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quel objet faut-il pour allumer un portail du Nether ?",
    choices: ["Briquet (silex et acier)", "Boussole", "Seau d'eau", "Arc"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel bloc est nécessaire pour fabriquer une table d'enchantement ?",
    choices: ["Diamant", "Obsidienne", "Or", "Émeraude"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quel minerai donne des lingots après cuisson ?",
    choices: ["Diamant", "Fer", "Redstone", "Lapis"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quelle nourriture rend le plus de points de faim (parmi ces choix) ?",
    choices: ["Pomme", "Pain", "Steak cuit", "Carotte"],
    a: 2,
  },
  {
    d: "easy",
    q: "Quel mob lâche des perles de l'Ender ?",
    choices: ["Enderman", "Slime", "Ghast", "Blaze"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel biome est principalement couvert de sable ?",
    choices: ["Plaine", "Désert", "Taïga", "Jungle"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quel est l'objectif final classique du jeu ?",
    choices: ["Trouver le Warden", "Battre l'Ender Dragon", "Construire un village", "Atteindre le niveau 100"],
    a: 1,
  },
  {
    d: "easy",
    q: "Comment s'appelle le bloc qui sert à crafter avec une grille 3x3 ?",
    choices: ["Table de craft", "Four", "Enclume", "Coffre"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel matériau faut-il pour fabriquer des torches ?",
    choices: ["Bois + charbon", "Pierre + bois", "Fer + bois", "Or + bois"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel objet permet de respirer sous l'eau ?",
    choices: ["Potion de force", "Potion de respiration aquatique", "Potion de vitesse", "Potion de soin"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quel outil sert à récolter le bois plus vite ?",
    choices: ["Pioche", "Hache", "Pelle", "Épée"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quelle armure est la plus résistante (vanilla) ?",
    choices: ["Cuir", "Fer", "Diamant", "Netherite"],
    a: 3,
  },
  {
    d: "easy",
    q: "Quel bloc sert à poser des objets et les exposer ?",
    choices: ["Cadre", "Panneau", "Lanterne", "Bannière"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel animal peut être apprivoisé avec des os ?",
    choices: ["Chat", "Chien (loup)", "Cheval", "Panda"],
    a: 1,
  },
  {
    d: "easy",
    q: "Comment s'appelle le mob volant du Nether qui tire des boules de feu ?",
    choices: ["Blaze", "Ghast", "Phantom", "Wither"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quel bloc stocke l'énergie de redstone dans le craft ?",
    choices: ["Bloc de redstone", "Bloc de charbon", "Bloc d'obsidienne", "Bloc de lapis"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quelle commande affiche les coordonnées (selon versions/paramètres) ?",
    choices: ["F3", "F1", "F5", "F11"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel est le matériau nécessaire pour faire un lit ?",
    choices: ["Laine + planches", "Cuir + planches", "Fer + laine", "Laine + pierre"],
    a: 0,
  },
  {
    d: "easy",
    q: "Combien de blocs d'obsidienne minimum pour un portail du Nether (cadre) ?",
    choices: ["10", "12", "14", "16"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel item obtient-on en cassant des feuilles (parfois) ?",
    choices: ["Bâton", "Graine", "Pomme", "Charbon"],
    a: 2,
  },
  {
    d: "easy",
    q: "Quel bloc est utilisé pour faire pousser les cultures ?",
    choices: ["Sable", "Terre labourée", "Gravier", "Netherrack"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quel mob apparaît la nuit et brûle au soleil ?",
    choices: ["Zombie", "Enderman", "Creeper", "Sorcière"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel item permet de conduire un bateau ?",
    choices: ["Rênes", "Aucun, on clique", "Selle", "Carotte sur bâton"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quel bloc sert à stocker des objets ?",
    choices: ["Coffre", "Four", "Seau", "Porte"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quelle ressource sert à fabriquer une boussole ?",
    choices: ["Fer + redstone", "Or + redstone", "Cuivre + lapis", "Diamant + fer"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel outil casse le sable le plus vite ?",
    choices: ["Pelle", "Pioche", "Hache", "Épée"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel mob marine donne des coquilles de nautile (souvent) ?",
    choices: ["Dauphin", "Noyé (drowned)", "Tortue", "Poisson-globe"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quel bloc émet de la lumière naturellement ?",
    choices: ["Torch", "Glowstone", "Dirt", "Cobblestone"],
    a: 1,
  },
  {
    d: "easy",
    q: "Quel item sert à écrire un livre ?",
    choices: ["Plume + encre + livre", "Livre + laine", "Livre + or", "Livre + arc"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quelle créature garde les villages la nuit ?",
    choices: ["Golem de fer", "Wither", "Gardien", "Allay"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel item permet de faire une carte vide ?",
    choices: ["Papier + boussole", "Papier + redstone", "Papier + charbon", "Papier + fer"],
    a: 0,
  },
  {
    d: "easy",
    q: "Quel bloc sert à réparer/renommer des objets ?",
    choices: ["Enclume", "Table de craft", "Furnace", "Composteur"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel item faut-il pour ouvrir une salle de l'End (activer le portail) ?",
    choices: ["Perles de l'Ender", "Yeux de l'Ender", "Bâtons de blaze", "Poussière de redstone"],
    a: 1,
  },
  {
    d: "medium",
    q: "De quoi est composé un œil de l'Ender (craft) ?",
    choices: ["Perle de l'Ender + poudre de blaze", "Perle + poudre de redstone", "Diamant + blaze", "Lapis + perle"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel mob lâche des bâtons de blaze ?",
    choices: ["Ghast", "Blaze", "Piglin", "Magma Cube"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quelle structure du Nether contient le plus souvent des Blazes ?",
    choices: ["Bastion", "Forteresse du Nether", "Ruines de portail", "Forêt carmin"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel enchantement augmente les drops d'un bloc/minerai ?",
    choices: ["Efficacité", "Fortune", "Toucher de soie", "Solidité"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel enchantement permet de miner un bloc et de le récupérer tel quel ?",
    choices: ["Fortune", "Toucher de soie", "Tranchant", "Raccommodage"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel item est nécessaire pour fabriquer un piston collant ?",
    choices: ["Boule de slime", "Miel", "Redstone", "Quartz"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel bloc ralentit et blesse légèrement quand on marche dessus (sans bottes) ?",
    choices: ["Cactus", "Magma", "Feu", "Glace"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel est le niveau de lumière minimum (classique) sous lequel des mobs hostiles peuvent apparaître (anciennement) ?",
    choices: ["0", "7", "15", "3"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quelle est la capacité d'une pile d'items la plus courante ?",
    choices: ["16", "32", "64", "99"],
    a: 2,
  },
  {
    d: "medium",
    q: "Quel bloc sert de point de réapparition dans le Nether ?",
    choices: ["Lit", "Ancre de réapparition", "Totem", "Coffre"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel item sert à éviter la mort en tombant dans le vide/à l'End (une fois) ?",
    choices: ["Totem d'immortalité", "Bouclier", "Pomme dorée", "Perle"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel enchantement permet de réparer un outil avec de l'XP ?",
    choices: ["Raccommodage", "Solidité", "Efficacité", "Fortune"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel bloc permet de fabriquer des potions ?",
    choices: ["Alambic (stand)", "Enclume", "Four", "Table d'enchantement"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel ingrédient sert de base pour beaucoup de potions (Nether) ?",
    choices: ["Verrue du Nether", "Sucre", "Poudre d'os", "Pomme"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel mob laisse tomber des membranes, utiles pour réparer l'élytre ?",
    choices: ["Phantom", "Chauve-souris", "Perroquet", "Allay"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel type de villageois échange des enchantements ?",
    choices: ["Fermier", "Bibliothécaire", "Pêcheur", "Armurier"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quelle ressource est nécessaire pour faire des rails propulseurs ?",
    choices: ["Redstone", "Or", "Fer", "Diamant"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel bloc permet de faire pousser les champignons géants du Nether ?",
    choices: ["Netherrack", "Nylium", "Endstone", "Soul sand"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel item permet de transformer un villageois en zombie-villageois (attaque) ?",
    choices: ["Trident", "Zombie", "Creeper", "Slime"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel est le nom du minerai utilisé pour fabriquer la netherite (ingot final) ?",
    choices: ["Débris antiques", "Quartz du Nether", "Charbon", "Cuivre"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel item obtient-on en cuisant du sable ?",
    choices: ["Pierre", "Verre", "Brique", "Terre cuite"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quelle commande permet de se téléporter (si autorisée) ?",
    choices: ["/warp", "/tp", "/home", "/fly"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel bloc est utilisé pour faire une carte de localisation des biomes (table cartographe) ?",
    choices: ["Table d'enchantement", "Table de cartographie", "Composteur", "Scie"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quelle est la durée standard d'un jour Minecraft (cycle complet) ?",
    choices: ["10 minutes", "20 minutes", "30 minutes", "60 minutes"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel item est nécessaire pour faire un seau ?",
    choices: ["3 lingots de fer", "3 lingots d'or", "3 diamants", "5 fer"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel enchantement réduit les dégâts de chute ?",
    choices: ["Protection", "Plume (Feather Falling)", "Épines", "Respiration"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quelle ressource sert à faire des blocs de TNT ?",
    choices: ["Poudre à canon + sable", "Charbon + sable", "Redstone + sable", "Soufre + pierre"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel item sert à attirer les cochons ?",
    choices: ["Blé", "Carotte", "Graine", "Pomme"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel item sert à attirer les vaches ?",
    choices: ["Blé", "Carotte", "Graine", "Pomme"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel item sert à attirer les poules ?",
    choices: ["Blé", "Graines", "Carotte", "Pomme"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel item sert à attirer les moutons ?",
    choices: ["Blé", "Graines", "Carotte", "Pomme"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel bloc permet de prendre un screenshot de la structure (structure block) en survival ?",
    choices: ["Impossible sans commandes", "Table de craft", "Enclume", "Coffre"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel mob du Nether échange avec de l'or (bartering) ?",
    choices: ["Blaze", "Piglin", "Wither Skeleton", "Ghast"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel item réduit la vitesse de chute et permet de planer ?",
    choices: ["Élytre", "Bottes", "Trident", "Bouclier"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel est le matériau principal des rails classiques ?",
    choices: ["Fer", "Or", "Cuivre", "Netherite"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel bloc sert à faire des feux de camp ?",
    choices: ["Charbon", "Bûche + bâton + charbon", "Pierre", "Sable"],
    a: 1,
  },
  {
    d: "medium",
    q: "Quel item sert à faire pousser plus vite les plantes ?",
    choices: ["Poudre d'os", "Sucre", "Charbon", "Redstone"],
    a: 0,
  },
  {
    d: "medium",
    q: "Quel biome contient naturellement beaucoup de champignons géants ?",
    choices: ["Désert", "Forêt sombre", "Champignon (mushroom fields)", "Savane"],
    a: 2,
  },
  {
    d: "medium",
    q: "Quel mob du Nether donne des larmes de ghast ?",
    choices: ["Ghast", "Blaze", "Magma cube", "Piglin"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quelle quantité d'XP environ donne un Ender Dragon (première fois) ?",
    choices: ["500", "12000", "6000", "20000"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel bloc permet de détecter les vibrations (1.19+) ?",
    choices: ["Capteur sculk", "Observateur", "Comparateur", "Détecteur de jour"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel est le nombre maximum de blocs que peut pousser un piston ?",
    choices: ["8", "12", "16", "64"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel type de signal utilise un comparateur en mode 'soustraction' ?",
    choices: ["Il multiplie le signal", "Il soustrait le signal latéral", "Il inverse le signal", "Il amplifie"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quelle potion est obtenue avec une verrue du Nether + sucre (base correcte -> vitesse) ?",
    choices: ["Force", "Vitesse", "Soin", "Invisibilité"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel ingrédient transforme une potion de vision nocturne en invisibilité ?",
    choices: ["Œil fermenté d'araignée", "Poussière de blaze", "Sucre", "Crème de magma"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel est le mob le plus dangereux de l'Ancient City ?",
    choices: ["Warden", "Enderman", "Wither", "Ravageur"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel bloc est nécessaire pour 'conduire' un strider ?",
    choices: ["Selle + champignon biscornu sur bâton", "Selle + carotte sur bâton", "Rênes", "Bottes de glace"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quelle structure de l'End contient des élytres ?",
    choices: ["Forteresse de l'End", "Ville de l'End", "Temple du désert", "Bastion"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel enchantement augmente les dégâts d'une épée sur tous les mobs ?",
    choices: ["Châtiment", "Tranchant", "Fléau des arthropodes", "Butin"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel mob lâche des têtes lorsqu'il est tué par un creeper chargé (possible) ?",
    choices: ["Creeper", "Squelette", "Golem de fer", "Villageois"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel bloc/entité permet de charger un creeper via la foudre ?",
    choices: ["Trident canalisateur", "Éclair naturel uniquement", "Potion", "Lave"],
    a: 0,
  },
  {
    d: "hard",
    q: "Dans l'End, sur quel bloc le dragon se pose au centre ?",
    choices: ["Bedrock", "Obsidienne", "Endstone", "Pierre"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quelle est la commande pour afficher les hitboxes (Java) ?",
    choices: ["F3+B", "F3+H", "F3+G", "F3+T"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel est le craft d'un observateur ?",
    choices: ["Quartz + cobblestone + redstone", "Fer + redstone + quartz", "Bois + redstone", "Obsidienne + quartz"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel effet donne une pomme dorée 'enchanted' (ancienne) ?",
    choices: ["Régénération + absorption + résistance + résistance au feu", "Seulement absorption", "Seulement régénération", "Vitesse + force"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel est le drop principal d'un Wither ?",
    choices: ["Étoile du Nether", "Tête de Wither", "Bloc de diamant", "Cristal de l'End"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quelle ressource est nécessaire pour faire un beacon (balise) ?",
    choices: ["Étoile du Nether", "Diamant", "Émeraude", "Quartz"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quelle est la hauteur maximale de construction en version 1.18+ (monde normal) ?",
    choices: ["256", "320", "384", "512"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel est le niveau minimum de Y du monde en 1.18+ ?",
    choices: ["-64", "0", "-32", "-128"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel enchantement permet de renvoyer des projectiles avec un bouclier (Bedrock) ?",
    choices: ["Réflexion", "Réparation", "Aucun (pas d'enchant)", "Protection"],
    a: 2,
  },
  {
    d: "hard",
    q: "Quel item permet de localiser un bastion (si on parle de 'boussole' spéciale 1.19+) ?",
    choices: ["Boussole", "Boussole de récupération (recovery compass)", "Carte au trésor", "Œil de l'Ender"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel est le nom du minerai ajouté pour la netherite (source) ?",
    choices: ["Ancient debris", "Nether gold", "Basalt ore", "Sculk ore"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel bloc fait rebondir les entités ?",
    choices: ["Slime block", "Honey block", "Wool block", "Glass"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel bloc colle mais ne rebondit pas (et ralentit) ?",
    choices: ["Slime block", "Honey block", "Ice block", "Soul sand"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel est le maximum de joueurs dans une équipe de scoreboard par défaut ?",
    choices: ["Illimité", "16", "8", "4"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel est le nom du boss invoqué avec 3 têtes + 4 sable des âmes ?",
    choices: ["Warden", "Wither", "Dragon", "Elder Guardian"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel item est nécessaire pour faire une potion de lenteur (à partir de vitesse) ?",
    choices: ["Œil fermenté d'araignée", "Crème de magma", "Poudre de blaze", "Larme de ghast"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quelle structure sous-marine contient un boss 'Elder Guardian' ?",
    choices: ["Monument océanique", "Épave", "Ruines océaniques", "Temple de la jungle"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel bloc empêche le sculk de propager les vibrations (isolation) ?",
    choices: ["Laine", "Verre", "Glace", "Dirt"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quelle est la capacité d'un seau de lave/eau (en blocs source) ?",
    choices: ["1", "2", "4", "8"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel enchantement sur trident attire la foudre pendant un orage ?",
    choices: ["Impaling", "Canalisation", "Loyauté", "Riptide"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel enchantement sur trident empêche de le perdre (revient) ?",
    choices: ["Riptide", "Loyauté", "Canalisation", "Mending"],
    a: 1,
  },
  {
    d: "hard",
    q: "Quel est l'effet principal de la 'Soul Speed' ?",
    choices: ["Courir plus vite sur le sable des âmes", "Nager plus vite", "Sauter plus haut", "Réduire les dégâts"],
    a: 0,
  },
  {
    d: "hard",
    q: "Quel est le nombre de blocs d'obsidienne nécessaires pour une table d'enchantement ?",
    choices: ["2", "3", "4", "5"],
    a: 2,
  },
];

/* ================== GAME STATES (in memory) ================== */
/* ================== MINI-JEUX (helpers) ================== */
const HANGMAN_WORDS = [
  "discord",
  "minecraft",
  "modpack",
  "survie",
  "plairepoilue",
  "aventurier",
  "diamant",
  "creeper",
  "nether",
  "redstone",
  "potion",
  "villageois",
];
function maskWord(word, guessedSet) {
  return word
    .split("")
    .map((ch) => (ch === "-" || ch === " " ? ch : guessedSet.has(ch) ? ch : "•"))
    .join(" ");
}
function cleanLetter(input) {
  const t = String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  const m = t.match(/[a-z]/);
  return m ? m[0] : null;
}

const quizState = new Map(); // userId -> { type, correctIndex, choices, question }
const tttGames = new Map();  // gameId -> { p1, p2, turn, board[9], msgId, channelId }
const rpsState = new Map();  // userId -> { createdAt }
const guessState = new Map(); // userId -> { secret, tries, createdAt }
const hangmanState = new Map(); // userId -> { word, guessed:Set, triesLeft, createdAt }

/* ================== BOT ================== */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // banwords
  ],
});

/* ================== COMMANDES ================== */
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("🏓 Tester le bot"),
  new SlashCommandBuilder().setName("help").setDescription("📌 Menu du bot"),

  new SlashCommandBuilder().setName("site").setDescription("🌍 Lien du site"),
  new SlashCommandBuilder().setName("version").setDescription("⛏️ Version du serveur"),
  new SlashCommandBuilder().setName("modpack").setDescription("📦 Lien du modpack"),
  new SlashCommandBuilder().setName("ip").setDescription("🧭 IP du serveur Minecraft"),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("🪪 Infos sur un membre")
    .addUserOption((o) =>
      o.setName("membre").setDescription("Le membre (optionnel)").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("💡 Proposer une suggestion")
    .addStringOption((o) =>
      o.setName("idee").setDescription("Ta suggestion").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("🧹 Supprimer des messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) =>
      o.setName("nombre").setDescription("1 à 100").setRequired(true).setMinValue(1).setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("⏳ Timeout un membre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName("membre").setDescription("Le membre à timeout").setRequired(true)
    )
    .addIntegerOption((o) =>
      o.setName("minutes").setDescription("Durée en minutes (1-10080)").setRequired(true).setMinValue(1).setMaxValue(10080)
    )
    .addStringOption((o) =>
      o.setName("raison").setDescription("Raison (optionnel)").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("banword")
    .setDescription("🚫 Gestion des mots interdits")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((s) =>
      s.setName("add").setDescription("Ajouter un terme")
        .addStringOption((o) => o.setName("terme").setDescription("Terme à interdire").setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName("remove").setDescription("Retirer un terme")
        .addStringOption((o) => o.setName("terme").setDescription("Terme à retirer").setRequired(true))
    )
    .addSubcommand((s) => s.setName("list").setDescription("Lister les termes"))
    .addSubcommand((s) => s.setName("clear").setDescription("Vider la liste")),

  new SlashCommandBuilder()
    .setName("emojizip")
    .setDescription("📦 Ajouter des emojis depuis un ZIP")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEmojisAndStickers)
    .addAttachmentOption((o) =>
      o.setName("zip").setDescription("Fichier .zip (png/jpg/gif)").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("emojiremove")
    .setDescription("🗑️ Supprimer les emojis les plus récents")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEmojisAndStickers)
    .addIntegerOption((o) =>
      o.setName("nombre").setDescription("Combien d’emojis supprimer (1-250)").setRequired(true).setMinValue(1).setMaxValue(250)
    ),
  new SlashCommandBuilder()
    .setName("emojidedupe")
    .setDescription("🧼 Supprime les emojis doublons (garde le plus ancien)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEmojisAndStickers)
    .addBooleanOption((o) =>
      o
        .setName("dryrun")
        .setDescription("Si activé, affiche seulement ce qui serait supprimé")
        .setRequired(false)
    ),


  /* ===== MINI-JEUX ===== */
  new SlashCommandBuilder()
    .setName("quiz")
    .setDescription("🎯 Quiz (général)")
    .addStringOption((o) =>
      o
        .setName("difficulte")
        .setDescription("Choisis une difficulté (sinon aléatoire)")
        .setRequired(false)
        .addChoices(
          { name: "🟢 Facile", value: "easy" },
          { name: "🟠 Moyen", value: "medium" },
          { name: "🔴 Difficile", value: "hard" },
          { name: "🎲 Aléatoire", value: "random" }
        )
    ),

  new SlashCommandBuilder()
    .setName("mcquiz")
    .setDescription("🧱 Quiz Minecraft")
    .addStringOption((o) =>
      o
        .setName("difficulte")
        .setDescription("Choisis une difficulté (sinon aléatoire)")
        .setRequired(false)
        .addChoices(
          { name: "🟢 Facile", value: "easy" },
          { name: "🟠 Moyen", value: "medium" },
          { name: "🔴 Difficile", value: "hard" },
          { name: "🎲 Aléatoire", value: "random" }
        )
    ),
  new SlashCommandBuilder().setName("leaderboard").setDescription("🏆 Classement des points"),
  new SlashCommandBuilder()
    .setName("duel")
    .setDescription("⚔️ Duel (défie quelqu’un)")
    .addUserOption((o) => o.setName("membre").setDescription("La personne à défier").setRequired(true)),
  new SlashCommandBuilder()
    .setName("bomb")
    .setDescription("💣 Tente ta chance sur quelqu’un")
    .addUserOption((o) => o.setName("membre").setDescription("La cible").setRequired(true)),
  new SlashCommandBuilder()
    .setName("tictactoe")
    .setDescription("❎⭕ Morpion (boutons)")
    .addUserOption((o) => o.setName("membre").setDescription("Adversaire").setRequired(true)),
  new SlashCommandBuilder()
    .setName("rps")
    .setDescription("🪨📄✂️ Pierre-Feuille-Ciseaux (contre le bot)"),

  new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("🪙 Pile ou Face (parie un choix)")
    .addStringOption((o) =>
      o
        .setName("choix")
        .setDescription("Ton choix")
        .setRequired(true)
        .addChoices(
          { name: "Pile", value: "pile" },
          { name: "Face", value: "face" }
        )
    ),

  new SlashCommandBuilder()
    .setName("dice")
    .setDescription("🎲 Dé (1-6) (parie un chiffre)")
    .addIntegerOption((o) =>
      o
        .setName("nombre")
        .setDescription("Ton pari (1-6)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(6)
    ),

  new SlashCommandBuilder()
    .setName("devine")
    .setDescription("🔢 Devine le nombre (1-100)")
    .addSubcommand((s) =>
      s.setName("start").setDescription("Commence une partie")
    )
    .addSubcommand((s) =>
      s
        .setName("propose")
        .setDescription("Propose un nombre")
        .addIntegerOption((o) =>
          o
            .setName("nombre")
            .setDescription("1 à 100")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)
        )
    ),

  new SlashCommandBuilder()
    .setName("pendu")
    .setDescription("🧩 Pendu (mot à deviner)")
    .addSubcommand((s) =>
      s.setName("start").setDescription("Commence une partie")
    )
    .addSubcommand((s) =>
      s
        .setName("lettre")
        .setDescription("Propose une lettre")
        .addStringOption((o) =>
          o
            .setName("valeur")
            .setDescription("Une lettre (a-z)")
            .setRequired(true)
        )
    ),
].map((c) => c.toJSON());

/* ================== READY ================== */
client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log(`🤖 Connecté : ${client.user.tag}`);
  console.log("✅ Commandes enregistrées");
});

/* ================== AUTO MODERATION (BANWORDS) ================== */
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;

  const words = loadBanwords();
  if (!words.length) return;

  const content = normalize(message.content);
  if (words.some((w) => content.includes(normalize(w)))) {
    await message.delete().catch(() => {});
    await message.author.send("⚠️ Ton message a été supprimé (mot/terme interdit).").catch(() => {});
  }
});

/* ================== HELP EMBED ================== */
function helpEmbed(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("📌 PlairePoilue • Menu du bot")
    .setDescription("Voici les commandes dispo 👇")
    .addFields(
      {
        name: "🧱 Minecraft",
        value: [
          "🌍 **/site** — lien du site",
          "⛏️ **/version** — version du serveur",
          "📦 **/modpack** — lien du modpack",
          "🧭 **/ip** — IP du serveur",
        ].join("\n"),
        inline: false,
      },
      {
        name: "👥 Communauté",
        value: [
          "🪪 **/userinfo** — infos d’un membre",
          "💡 **/suggest** — proposer une idée",
        ].join("\n"),
        inline: false,
      },
      {
        name: "🛡️ Modération",
        value: [
          "🧹 **/clear** — supprimer des messages *(modo)*",
          "⏳ **/timeout** — mute temporaire *(modo)*",
          "🚫 **/banword** — add/remove/list/clear *(modo)*",
          "📦 **/emojizip** — ajouter emojis via ZIP *(admin)*",
          "🗑️ **/emojiremove** — remove emojis récents *(admin)*",
        ].join("\n"),
        inline: false,
      },
      {
        name: "🎮 Mini-jeux",
        value: [
          "🎯 **/quiz** — quiz général *(facile/moyen/difficile)*",
          "🧱 **/mcquiz** — quiz Minecraft *(facile/moyen/difficile)*",
          "🏆 **/leaderboard** — classement points",
          "⚔️ **/duel** — défie quelqu’un",
          "💣 **/bomb** — roulette explosive",
          "❎⭕ **/tictactoe** — morpion (boutons)",
        ].join("\n"),
        inline: false,
      }
    )
    .setFooter({ text: `Demandé par ${interaction.user.username}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel("🌍 Site").setStyle(ButtonStyle.Link).setURL(SITE_URL),
    new ButtonBuilder().setLabel("📦 Modpack").setStyle(ButtonStyle.Link).setURL(MODPACK_URL)
  );

  return { embed, row };
}

/* ================== QUIZ HELPERS ================== */
function makeQuizButtons(ownerId, type, choices) {
  // 4 boutons max (on a 4 choices)
  const row = new ActionRowBuilder();
  for (let i = 0; i < choices.length; i++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`quiz:${type}:${ownerId}:${i}`)
        .setLabel(choices[i])
        .setStyle(ButtonStyle.Secondary)
    );
  }
  return [row];
}

function startQuiz(interaction, type, difficulty = "random") {
  const bankAll = type === "mc" ? MCQUIZ_BANK : QUIZ_BANK;

  const diff = (difficulty || "random").toLowerCase();
  const bank =
    diff === "random"
      ? bankAll
      : bankAll.filter((it) => (it.d || "medium") === diff);

  const pickFrom = bank.length ? bank : bankAll;
  const item = pickRandom(pickFrom);

  const pointsByDiff = { easy: 2, medium: 3, hard: 5 };
  const pts = pointsByDiff[item.d] ?? 3;

  quizState.set(interaction.user.id, {
    type,
    difficulty: item.d || "medium",
    points: pts,
    correctIndex: item.a,
    choices: item.choices,
    question: item.q,
    ts: Date.now(),
  });

  const badge = item.d === "easy" ? "🟢" : item.d === "hard" ? "🔴" : "🟠";

  const embed = new EmbedBuilder()
    .setTitle(type === "mc" ? "🧱 Minecraft Quiz" : "🎯 Quiz")
    .setDescription(`**${item.q}**

Difficulté: **${badge} ${item.d}** • Récompense: **+${pts}** pts

Choisis une réponse 👇`)
    .setFooter({ text: "Réponds avec les boutons" });

  return interaction.reply({
    embeds: [embed],
    components: makeQuizButtons(interaction.user.id, type, item.choices),
    ephemeral: false,
  });
}

/* ================== TICTACTOE HELPERS ================== */
function tttRender(board) {
  // board: array of "X","O",null
  return board.map((c) => (c ? c : "⬜"));
}
function tttCheckWin(board) {
  const lines = [
    [0, 1, 2],[3, 4, 5],[6, 7, 8],
    [0, 3, 6],[1, 4, 7],[2, 5, 8],
    [0, 4, 8],[2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every(Boolean)) return "DRAW";
  return null;
}
function tttBoardComponents(gameId, board, locked = false) {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      const cell = board[idx];
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ttt:${gameId}:${idx}`)
          .setLabel(cell ? cell : " ")
          .setStyle(cell ? ButtonStyle.Secondary : ButtonStyle.Primary)
          .setDisabled(locked || Boolean(cell))
      );
    }
    rows.push(row);
  }
  return rows;
}

/* ================== INTERACTIONS ================== */
client.on("interactionCreate", async (interaction) => {
  try {
    /* ===== Buttons (quiz/duel/ttt) ===== */
    if (interaction.isButton()) {
      const id = interaction.customId;

      // QUIZ BUTTON
      if (id.startsWith("quiz:")) {
        const [, type, ownerId, choiceStr] = id.split(":");
        const choice = parseInt(choiceStr, 10);

        // seul le joueur qui a lancé peut répondre
        if (interaction.user.id !== ownerId) {
          return interaction.reply({ content: "⛔ C’est pas ton quiz.", ephemeral: true });
        }

        const st = quizState.get(ownerId);
        if (!st) return interaction.reply({ content: "⌛ Quiz expiré.", ephemeral: true });

        const correct = st.correctIndex === choice;

        // points
        const data = loadData();
        const us = getUserStats(data, interaction.user.id);

        if (correct) {
          us.points += (st.points || 3);
          if (type === "mc") us.mcquizCorrect += 1;
          else us.quizCorrect += 1;
          saveData(data);
        }

        // disable buttons
        const embed = new EmbedBuilder()
          .setTitle(type === "mc" ? "🧱 Minecraft Quiz" : "🎯 Quiz")
          .setDescription(
            `**${st.question}**\n\n` +
            (correct
              ? `✅ Bonne réponse ! **+${st.points || 3} points**`
              : `❌ Mauvaise réponse.\n✅ Réponse : **${st.choices[st.correctIndex]}**`)
          )
          .setTimestamp();

        quizState.delete(ownerId);

        // Lock components
        const disabledRows = interaction.message.components.map((row) => {
          const newRow = ActionRowBuilder.from(row);
          newRow.components = newRow.components.map((btn) => ButtonBuilder.from(btn).setDisabled(true));
          return newRow;
        });

        await interaction.update({ embeds: [embed], components: disabledRows });
        return;
      }

      // DUEL ACCEPT
      if (id.startsWith("duel:")) {
        const [, challengerId, targetId] = id.split(":");
        if (interaction.user.id !== targetId) {
          return interaction.reply({ content: "⛔ Seule la cible peut accepter.", ephemeral: true });
        }

        const winner = Math.random() < 0.5 ? challengerId : targetId;
        const loser = winner === challengerId ? targetId : challengerId;

        const data = loadData();
        const w = getUserStats(data, winner);
        const l = getUserStats(data, loser);
        w.points += 5;
        w.duelWins += 1;
        l.duelLosses += 1;
        saveData(data);

        const embed = new EmbedBuilder()
          .setTitle("⚔️ Duel")
          .setDescription(
            `🎉 Gagnant : <@${winner}> (**+5 points**)\n` +
            `💀 Perdant : <@${loser}>`
          )
          .setTimestamp();

        // disable button
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("duel:disabled").setLabel("Duel terminé").setStyle(ButtonStyle.Secondary).setDisabled(true)
        );

        await interaction.update({ embeds: [embed], components: [row] });
        return;
      }

      // TICTACTOE CLICK
      if (id.startsWith("ttt:")) {
        const [, gameId, posStr] = id.split(":");
        const pos = parseInt(posStr, 10);

        const game = tttGames.get(gameId);
        if (!game) return interaction.reply({ content: "⌛ Partie expirée.", ephemeral: true });

        const { p1, p2 } = game;
        const players = [p1, p2];

        if (!players.includes(interaction.user.id)) {
          return interaction.reply({ content: "⛔ Tu n’es pas dans cette partie.", ephemeral: true });
        }

        if (interaction.user.id !== game.turn) {
          return interaction.reply({ content: "⏳ Pas ton tour.", ephemeral: true });
        }

        if (game.board[pos]) {
          return interaction.reply({ content: "⚠️ Case déjà prise.", ephemeral: true });
        }

        const symbol = interaction.user.id === p1 ? "X" : "O";
        game.board[pos] = symbol;

        const win = tttCheckWin(game.board);

        if (win) {
          let desc = "";
          let locked = true;

          if (win === "DRAW") {
            desc = "🤝 Match nul !";
          } else {
            const winnerId = win === "X" ? p1 : p2;
            const loserId = winnerId === p1 ? p2 : p1;

            const data = loadData();
            const w = getUserStats(data, winnerId);
            const l = getUserStats(data, loserId);
            w.points += 5;
            w.tttWins += 1;
            l.tttLosses += 1;
            saveData(data);

            desc = `🎉 <@${winnerId}> gagne (**+5 points**)`;
          }

          const embed = new EmbedBuilder()
            .setTitle("❎⭕ TicTacToe")
            .setDescription(`${desc}\n\n${tttRender(game.board).slice(0,3).join("")}\n${tttRender(game.board).slice(3,6).join("")}\n${tttRender(game.board).slice(6,9).join("")}`)
            .setTimestamp();

          tttGames.delete(gameId);

          await interaction.update({
            embeds: [embed],
            components: tttBoardComponents(gameId, game.board, locked),
          });
          return;
        }

        // switch turn
        game.turn = game.turn === p1 ? p2 : p1;

        const embed = new EmbedBuilder()
          .setTitle("❎⭕ TicTacToe")
          .setDescription(
            `Tour de : ${game.turn === p1 ? `<@${p1}> (X)` : `<@${p2}> (O)`}\n\n` +
            `${tttRender(game.board).slice(0,3).join("")}\n${tttRender(game.board).slice(3,6).join("")}\n${tttRender(game.board).slice(6,9).join("")}`
          )
          .setTimestamp();

        await interaction.update({
          embeds: [embed],
          components: tttBoardComponents(gameId, game.board, false),
        });
        return;
      }


      // RPS BUTTON
      if (id.startsWith("rps:")) {
        const [, ownerId, choice] = id.split(":");

        if (interaction.user.id !== ownerId) {
          return interaction.reply({ content: "⛔ C’est pas ton RPS.", ephemeral: true });
        }

        const botChoices = ["pierre", "feuille", "ciseaux"];
        const bot = botChoices[Math.floor(Math.random() * botChoices.length)];

        const beats = { pierre: "ciseaux", feuille: "pierre", ciseaux: "feuille" };
        let result = "draw";
        if (choice === bot) result = "draw";
        else if (beats[choice] === bot) result = "win";
        else result = "lose";

        const data = loadData();
        const st = getUserStats(data, ownerId);

        let desc = `Tu as choisi **${choice}**.
Le bot a choisi **${bot}**.

`;
        if (result === "win") {
          st.points += 2;
          desc += "🎉 **Gagné !** (+2 points)";
        } else if (result === "lose") {
          st.points = Math.max(0, (st.points || 0) - 1);
          desc += "😵 **Perdu…** (-1 point)";
        } else {
          desc += "🤝 **Égalité.** (+0)";
        }
        saveData(data);

        const embed = new EmbedBuilder()
          .setTitle("🪨📄✂️ Pierre-Feuille-Ciseaux")
          .setDescription(desc)
          .setFooter({ text: `Points: ${st.points}` })
          .setTimestamp();

        return interaction.update({ embeds: [embed], components: [] });
      }


      return;
    }

    /* ===== Slash commands ===== */
    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName;

    if (name === "ping") return interaction.reply({ content: "🏓 pong", ephemeral: true });

    if (name === "help") {
      const { embed, row } = helpEmbed(interaction);
      return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    if (name === "site") return interaction.reply({ content: `🌍 ${SITE_URL}` });
    if (name === "version") return interaction.reply({ content: `⛏️ Version : **${MC_VERSION}**` });
    if (name === "modpack") return interaction.reply({ content: `📦 ${MODPACK_URL}` });
    if (name === "ip") return interaction.reply({ content: `🧭 **IP : ${MC_IP}** (v${MC_VERSION})` });

    if (name === "userinfo") {
      const user = interaction.options.getUser("membre") || interaction.user;
      const embed = new EmbedBuilder()
        .setTitle("🪪 User Info")
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: "👤 Utilisateur", value: `${user} (${user.tag})`, inline: false },
          { name: "🆔 ID", value: user.id, inline: true },
          { name: "📅 Créé le", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`, inline: false }
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (name === "suggest") {
      const idea = interaction.options.getString("idee", true);
      let target = interaction.channel;

      if (SUGGEST_CHANNEL_ID) {
        const ch = await interaction.guild.channels.fetch(SUGGEST_CHANNEL_ID).catch(() => null);
        if (ch && ch.isTextBased()) target = ch;
      }

      const embed = new EmbedBuilder()
        .setTitle("💡 Nouvelle suggestion")
        .setDescription(idea)
        .addFields({ name: "Auteur", value: `${interaction.user}`, inline: true })
        .setFooter({ text: "Vote avec 👍 / 👎" })
        .setTimestamp();

      const msg = await target.send({ embeds: [embed] });
      await msg.react("👍").catch(() => {});
      await msg.react("👎").catch(() => {});

      return interaction.reply({ content: `✅ Suggestion envoyée dans ${target}.`, ephemeral: true });
    }

    if (name === "clear") {
      const n = interaction.options.getInteger("nombre", true);
      const del = await interaction.channel.bulkDelete(n, true).catch(() => null);
      const count = del ? del.size : 0;
      return interaction.reply({
        content: `🧹 Supprimé **${count}** message(s). (Les messages > 14 jours ne peuvent pas être supprimés.)`,
        ephemeral: true,
      });
    }

    if (name === "timeout") {
      const user = interaction.options.getUser("membre", true);
      const minutes = interaction.options.getInteger("minutes", true);
      const reason = interaction.options.getString("raison") || "Aucune raison";

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ Membre introuvable.", ephemeral: true });

      await member.timeout(minutes * 60 * 1000, reason);
      return interaction.reply({
        content: `⏳ ${user} timeout **${minutes} min**.\n📝 Raison: ${reason}`,
        ephemeral: true,
      });
    }

    if (name === "banword") {
      let words = loadBanwords();
      const sub = interaction.options.getSubcommand();

      if (sub === "add") {
        const term = interaction.options.getString("terme", true);
        words.push(term);
        words = saveBanwords(words);
        return interaction.reply({ content: `✅ Ajouté. (${words.length})`, ephemeral: true });
      }

      if (sub === "remove") {
        const term = interaction.options.getString("terme", true);
        const before = words.length;
        words = words.filter((w) => normalize(w) !== normalize(term));
        words = saveBanwords(words);
        return interaction.reply({
          content: words.length === before ? "⚠️ Introuvable." : `🗑️ Retiré. (${words.length})`,
          ephemeral: true,
        });
      }

      if (sub === "list") {
        return interaction.reply({
          content: words.length
            ? `🚫 Banwords (${words.length})\n• ` + words.slice(0, 40).join("\n• ")
            : "📭 Liste vide.",
          ephemeral: true,
        });
      }

      if (sub === "clear") {
        saveBanwords([]);
        return interaction.reply({ content: "🧹 Liste vidée.", ephemeral: true });
      }
    }

    if (name === "emojizip") {
      const file = interaction.options.getAttachment("zip", true);

      if (!file.name?.toLowerCase().endsWith(".zip")) {
        return interaction.reply({ content: "❌ Fichier **.zip** uniquement.", ephemeral: true });
      }

      await interaction.reply({ content: "⏳ Téléchargement & import des emojis...", ephemeral: true });

      let buffer;
      try {
        buffer = await downloadToBuffer(file.url);
      } catch {
        return interaction.editReply("❌ Impossible de télécharger le ZIP (trop gros ou erreur).");
      }

      let zip;
      try {
        zip = new AdmZip(buffer);
      } catch {
        return interaction.editReply("❌ ZIP invalide/corrompu.");
      }

      const entries = zip
        .getEntries()
        .filter((e) => !e.isDirectory && /\.(png|jpg|jpeg|gif)$/i.test(e.entryName));

      if (!entries.length) {
        return interaction.editReply("📭 Aucun fichier image trouvé dans le ZIP (png/jpg/gif).");
      }

      const MAX = 50;
      const MAX_BYTES = 256 * 1024;

      let ok = 0;
      let skipped = 0;
      let failed = 0;

      const emojis = await interaction.guild.emojis.fetch();

      for (const e of entries.slice(0, MAX)) {
        try {
          const data = e.getData();
          if (!data || data.length > MAX_BYTES) {
            failed++;
            continue;
          }

          const name = sanitizeEmojiName(path.parse(e.entryName).name);
          if (emojis.some((em) => em.name === name)) {
            skipped++;
            continue;
          }

          await interaction.guild.emojis.create({ attachment: data, name });
          ok++;
        } catch {
          failed++;
        }
      }

      const more = entries.length > MAX ? `\n⚠️ Traitement max ${MAX} / ${entries.length}.` : "";
      return interaction.editReply(
        `✅ Import terminé :\n• Ajoutés: **${ok}**\n• Déjà existants: **${skipped}**\n• Erreurs/refus: **${failed}**${more}\n\n💡 Emojis < **256KB**.`
      );
    }

    if (name === "emojiremove") {
      const amount = Math.min(interaction.options.getInteger("nombre", true), 250);

      await interaction.reply({ content: `⏳ Suppression de **${amount}** emoji(s) récents...`, ephemeral: true });

      const emojis = await interaction.guild.emojis.fetch();
      const sorted = [...emojis.values()].sort(
        (a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0)
      );

      let ok = 0;
      let failed = 0;

      for (const e of sorted.slice(0, amount)) {
        try {
          await e.delete(`emojiremove par ${interaction.user.tag}`);
          ok++;
        } catch {
          failed++;
        }
      }

      return interaction.editReply(`🗑️ Terminé.\n• Supprimés: **${ok}**\n• Erreurs: **${failed}**`);
    }

    if (name === "emojidedupe") {
      const dryrun = interaction.options.getBoolean("dryrun") ?? true;

      await interaction.reply({
        content: `⏳ Scan des emojis pour détecter les doublons… (dryrun: **${dryrun ? "ON" : "OFF"}**)`,
        ephemeral: true,
      });

      const emojis = await interaction.guild.emojis.fetch();

      const groups = new Map(); // hash -> array of emoji
      let scanned = 0;
      let failedFetch = 0;

      for (const e of emojis.values()) {
        try {
          const buf = await downloadToBuffer(e.url, 1024 * 1024); // 1MB max
          const h = sha256(buf);
          if (!groups.has(h)) groups.set(h, []);
          groups.get(h).push(e);
          scanned++;
        } catch {
          failedFetch++;
        }
      }

      const toDelete = [];
      for (const arr of groups.values()) {
        if (arr.length < 2) continue;
        arr.sort((a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0)); // plus ancien d'abord
        // garder le plus ancien, supprimer le reste
        for (const dup of arr.slice(1)) toDelete.push(dup);
      }

      if (!toDelete.length) {
        return interaction.editReply(
          `✅ Aucun doublon détecté.\nScannés: **${scanned}** • Échecs fetch: **${failedFetch}**`
        );
      }

      const preview = toDelete
        .slice(0, 20)
        .map((e) => `• :${e.name}: (\`${e.id}\`)`)
        .join("\n");
      const more = toDelete.length > 20 ? `\n… +${toDelete.length - 20} autre(s)` : "";

      if (dryrun) {
        return interaction.editReply(
          `🧼 **DRYRUN** — je supprimerais **${toDelete.length}** emoji(s) doublon (garde le plus ancien).\n` +
          `Scannés: **${scanned}** • Échecs fetch: **${failedFetch}**\n\n` +
          `${preview}${more}\n\n` +
          `➡️ Relance avec \`/emojidedupe dryrun:false\` pour supprimer.`
        );
      }

      let ok = 0;
      let failed = 0;

      for (const e of toDelete) {
        try {
          await e.delete(`emojidedupe par ${interaction.user.tag}`);
          ok++;
        } catch {
          failed++;
        }
      }

      return interaction.editReply(
        `🧼 Terminé.\n• Supprimés: **${ok}**\n• Erreurs: **${failed}**\n` +
        `Scannés: **${scanned}** • Échecs fetch: **${failedFetch}**`
      );
    }


    /* ===== MINI-JEUX COMMANDS ===== */

    if (name === "quiz") {
      return startQuiz(interaction, "gen", interaction.options.getString("difficulte") || "random");
    }

    if (name === "mcquiz") {
      return startQuiz(interaction, "mc", interaction.options.getString("difficulte") || "random");
    }

    if (name === "leaderboard") {
      const data = loadData();
      const entries = Object.entries(data.users || {});
      entries.sort((a, b) => (b[1].points || 0) - (a[1].points || 0));
      const top = entries.slice(0, 10);

      const lines = top.length
        ? top.map(([id, st], i) => `**${i + 1}.** <@${id}> — **${st.points || 0}** pts`).join("\n")
        : "Personne n’a de points pour l’instant.";

      const embed = new EmbedBuilder()
        .setTitle("🏆 Leaderboard")
        .setDescription(lines)
        .setFooter({ text: "Gagne des points avec /quiz /mcquiz /duel /bomb /tictactoe" })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (name === "duel") {
      const target = interaction.options.getUser("membre", true);

      if (target.bot) {
        return interaction.reply({ content: "🤖 Tu peux pas duel un bot.", ephemeral: true });
      }
      if (target.id === interaction.user.id) {
        return interaction.reply({ content: "😅 Tu peux pas te duel toi-même.", ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle("⚔️ Duel")
        .setDescription(`🔥 <@${interaction.user.id}> défie <@${target.id}> !\n\n👉 <@${target.id}> clique pour accepter.`)
        .setFooter({ text: "Gagnant: +5 points" })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`duel:${interaction.user.id}:${target.id}`)
          .setLabel("✅ Accepter le duel")
          .setStyle(ButtonStyle.Success)
      );

      return interaction.reply({ embeds: [embed], components: [row] });
    }

    if (name === "bomb") {
      const target = interaction.options.getUser("membre", true);

      if (target.bot) {
        return interaction.reply({ content: "🤖 Pas de bomb sur les bots.", ephemeral: true });
      }
      if (target.id === interaction.user.id) {
        return interaction.reply({ content: "💣 Tu peux pas te bomb toi-même.", ephemeral: true });
      }

      // 50/50
      const win = Math.random() < 0.5;

      const data = loadData();
      const a = getUserStats(data, interaction.user.id);
      const t = getUserStats(data, target.id);

      let desc = "";

      if (win) {
        a.points += 4;
        a.bombWins += 1;
        t.bombLosses += 1;
        desc = `💥 **BOOM !** <@${target.id}> explose.\n🎉 <@${interaction.user.id}> gagne **+4 points**`;
      } else {
        a.points = Math.max(0, a.points - 2);
        a.bombLosses += 1;
        t.bombWins += 1;
        desc = `🧨 Oups… la bombe se retourne !\n😵 <@${interaction.user.id}> perd **-2 points**`;
      }

      saveData(data);

      const embed = new EmbedBuilder()
        .setTitle("💣 Bomb")
        .setDescription(desc)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (name === "tictactoe") {
      const target = interaction.options.getUser("membre", true);

      if (target.bot) {
        return interaction.reply({ content: "🤖 Tu peux pas jouer contre un bot (pour l’instant).", ephemeral: true });
      }
      if (target.id === interaction.user.id) {
        return interaction.reply({ content: "😅 Tu peux pas jouer contre toi-même.", ephemeral: true });
      }

      const gameId = `${interaction.id}-${Date.now()}`;
      const board = Array(9).fill(null);
      const p1 = interaction.user.id;
      const p2 = target.id;

      tttGames.set(gameId, {
        p1,
        p2,
        turn: p1,
        board,
      });

      const embed = new EmbedBuilder()
        .setTitle("❎⭕ TicTacToe")
        .setDescription(
          `Partie: <@${p1}> (X) vs <@${p2}> (O)\n` +
          `Tour de: <@${p1}> (X)\n\n` +
          `${tttRender(board).slice(0,3).join("")}\n${tttRender(board).slice(3,6).join("")}\n${tttRender(board).slice(6,9).join("")}`
        )
        .setFooter({ text: "Gagnant: +5 points" })
        .setTimestamp();

      return interaction.reply({
        content: `🎮 <@${p2}> viens jouer !`,
        embeds: [embed],
        components: tttBoardComponents(gameId, board, false),
      });
    }

    if (name === "rps") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rps:${interaction.user.id}:pierre`).setLabel("🪨 Pierre").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`rps:${interaction.user.id}:feuille`).setLabel("📄 Feuille").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`rps:${interaction.user.id}:ciseaux`).setLabel("✂️ Ciseaux").setStyle(ButtonStyle.Secondary)
      );

      const embed = new EmbedBuilder()
        .setTitle("🪨📄✂️ Pierre-Feuille-Ciseaux")
        .setDescription("Choisis ton coup 👇")
        .setFooter({ text: "Gagné: +2 • Perdu: -1 • Égalité: 0" });

      return interaction.reply({ embeds: [embed], components: [row] });
    }

    if (name === "coinflip") {
      const choix = interaction.options.getString("choix", true); // pile/face
      const res = Math.random() < 0.5 ? "pile" : "face";

      const data = loadData();
      const st = getUserStats(data, interaction.user.id);

      let desc = `Tu as choisi **${choix}**.
Résultat: **${res}**.

`;
      if (choix === res) {
        st.points += 1;
        desc += "🎉 **Gagné !** (+1 point)";
      } else {
        st.points = Math.max(0, (st.points || 0) - 1);
        desc += "😵 **Perdu…** (-1 point)";
      }
      saveData(data);

      const embed = new EmbedBuilder()
        .setTitle("🪙 Pile ou Face")
        .setDescription(desc)
        .setFooter({ text: `Points: ${st.points}` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (name === "dice") {
      const pari = interaction.options.getInteger("nombre", true);
      const roll = 1 + Math.floor(Math.random() * 6);

      const data = loadData();
      const st = getUserStats(data, interaction.user.id);

      let desc = `Ton pari: **${pari}**
Le dé: **${roll}**

`;
      if (pari === roll) {
        st.points += 2;
        desc += "🎉 **Pile poil !** (+2 points)";
      } else {
        st.points = Math.max(0, (st.points || 0) - 1);
        desc += "😵 **Raté…** (-1 point)";
      }
      saveData(data);

      const embed = new EmbedBuilder()
        .setTitle("🎲 Dé")
        .setDescription(desc)
        .setFooter({ text: `Points: ${st.points}` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (name === "devine") {
      const sub = interaction.options.getSubcommand();

      if (sub === "start") {
        const secret = 1 + Math.floor(Math.random() * 100);
        guessState.set(interaction.user.id, { secret, tries: 0, createdAt: Date.now() });

        const embed = new EmbedBuilder()
          .setTitle("🔢 Devine le nombre")
          .setDescription("J\'ai choisi un nombre entre **1** et **100**.\nUtilise `/devine propose nombre:<ton nombre>`.")
          .setFooter({ text: "Récompense: +3 points si tu trouves" });

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (sub === "propose") {
        const n = interaction.options.getInteger("nombre", true);
        const stt = guessState.get(interaction.user.id);
        if (!stt) {
          return interaction.reply({ content: "❌ Pas de partie en cours. Fais `/devine start`.", ephemeral: true });
        }

        stt.tries += 1;

        if (n === stt.secret) {
          guessState.delete(interaction.user.id);

          const data = loadData();
          const st = getUserStats(data, interaction.user.id);
          st.points += 3;
          saveData(data);

          const embed = new EmbedBuilder()
            .setTitle("✅ Trouvé !")
            .setDescription(`🎉 Bravo, c'était **${n}**.
Essais: **${stt.tries}**

+3 points`)
            .setFooter({ text: `Points: ${st.points}` })
            .setTimestamp();

          return interaction.reply({ embeds: [embed] });
        }

        const hint = n < stt.secret ? "📈 C'est **plus** !" : "📉 C'est **moins** !";
        return interaction.reply({ content: `${hint} (essai #${stt.tries})`, ephemeral: true });
      }
    }

    if (name === "pendu") {
      const sub = interaction.options.getSubcommand();

      if (sub === "start") {
        const word = HANGMAN_WORDS[Math.floor(Math.random() * HANGMAN_WORDS.length)];
        const guessed = new Set();
        hangmanState.set(interaction.user.id, { word, guessed, triesLeft: 6, createdAt: Date.now() });

        const embed = new EmbedBuilder()
          .setTitle("🧩 Pendu")
          .setDescription(
            `Mot: **${maskWord(word, guessed)}**

` +
            `Essais restants: **6**
` +
            `Propose une lettre avec: \`/pendu lettre valeur:a\``
          )
          .setFooter({ text: "Gagné: +4 • Perdu: -2" });

        return interaction.reply({ embeds: [embed] });
      }

      if (sub === "lettre") {
        const val = interaction.options.getString("valeur", true);
        const letter = cleanLetter(val);

        if (!letter) {
          return interaction.reply({ content: "❌ Donne une lettre (a-z).", ephemeral: true });
        }

        const game = hangmanState.get(interaction.user.id);
        if (!game) {
          return interaction.reply({ content: "❌ Pas de partie en cours. Fais `/pendu start`.", ephemeral: true });
        }

        if (game.guessed.has(letter)) {
          return interaction.reply({ content: `⚠️ Tu as déjà proposé **${letter}**.`, ephemeral: true });
        }

        game.guessed.add(letter);

        const has = game.word.includes(letter);
        if (!has) game.triesLeft -= 1;

        const solved = [...new Set(game.word.split("").filter((c) => c !== "-" && c !== " "))].every((c) => game.guessed.has(c));

        // Fin de partie
        if (solved || game.triesLeft <= 0) {
          hangmanState.delete(interaction.user.id);

          const data = loadData();
          const st = getUserStats(data, interaction.user.id);

          let desc = "";
          if (solved) {
            st.points += 4;
            desc = `🎉 **Gagné !** Le mot était **${game.word}**
+4 points`;
          } else {
            st.points = Math.max(0, (st.points || 0) - 2);
            desc = `💀 **Perdu…** Le mot était **${game.word}**
-2 points`;
          }
          saveData(data);

          const embed = new EmbedBuilder()
            .setTitle("🧩 Pendu • Fin")
            .setDescription(desc)
            .setFooter({ text: `Points: ${st.points}` })
            .setTimestamp();

          return interaction.reply({ embeds: [embed] });
        }

        const embed = new EmbedBuilder()
          .setTitle("🧩 Pendu")
          .setDescription(
            `${has ? "✅ Bonne lettre !" : "❌ Mauvaise lettre…"}

` +
            `Mot: **${maskWord(game.word, game.guessed)}**
` +
            `Essais restants: **${game.triesLeft}**
` +
            `Déjà proposés: ${[...game.guessed].sort().join(", ")}`
          )
          .setTimestamp();

        return interaction.reply({ embeds: [embed] });
      }
    }

  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({ content: "❌ Erreur inattendue.", ephemeral: true });
      } catch {}
    }
  }
});

/* ================== LOGIN ================== */
client.login(TOKEN);