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
    q: "Quelle planète est la plus proche du Soleil ?",
    choices: ["Vénus", "Mercure", "Mars", "Jupiter"],
    a: 1,
  },
  {
    q: "Combien de minutes dans 2 heures ?",
    choices: ["90", "100", "120", "180"],
    a: 2,
  },
  {
    q: "Quel animal miaule ?",
    choices: ["Chien", "Chat", "Vache", "Cheval"],
    a: 1,
  },
  {
    q: "Quel est le résultat de 7×8 ?",
    choices: ["54", "56", "58", "64"],
    a: 1,
  },
];

const MCQUIZ_BANK = [
  {
    q: "Quel minerai sert à fabriquer une pioche en diamant ?",
    choices: ["Charbon", "Fer", "Diamant", "Redstone"],
    a: 2,
  },
  {
    q: "Quel mob explose au contact ?",
    choices: ["Zombie", "Creeper", "Squelette", "Araignée"],
    a: 1,
  },
  {
    q: "Quel item permet de voler en end ?",
    choices: ["Elytra", "Trident", "Carotte", "Arc"],
    a: 0,
  },
  {
    q: "Pour aller au Nether, on utilise…",
    choices: ["Pierre", "Obsidienne", "Sable", "Glace"],
    a: 1,
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
  new SlashCommandBuilder().setName("quiz").setDescription("🎯 Quiz (général)"),
  new SlashCommandBuilder().setName("mcquiz").setDescription("🧱 Quiz Minecraft"),
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
          "🎯 **/quiz** — quiz général",
          "🧱 **/mcquiz** — quiz Minecraft",
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

function startQuiz(interaction, type) {
  const bank = type === "mc" ? MCQUIZ_BANK : QUIZ_BANK;
  const item = pickRandom(bank);
  quizState.set(interaction.user.id, {
    type,
    correctIndex: item.a,
    choices: item.choices,
    question: item.q,
    ts: Date.now(),
  });

  const embed = new EmbedBuilder()
    .setTitle(type === "mc" ? "🧱 Minecraft Quiz" : "🎯 Quiz")
    .setDescription(`**${item.q}**\n\nChoisis une réponse 👇`)
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
          us.points += 3;
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
              ? `✅ Bonne réponse ! **+3 points**`
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
      return startQuiz(interaction, "gen");
    }

    if (name === "mcquiz") {
      return startQuiz(interaction, "mc");
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