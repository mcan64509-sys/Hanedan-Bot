const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
} = require("discord.js");

const { spawn } = require("node:child_process");
const fs = require("node:fs");

const { Player } = require("discord-player");
const { DefaultExtractors } = require("@discord-player/extractor");
const {
  YouTubeDlpExtractor,
  setFFmpegPath,
  setYtDlpPath,
} = require("discord-player-youtubedlp");

// ======================================================
// ENV
// ======================================================

const ENV = {
  TOKEN: process.env.TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  GUILD_ID: process.env.GUILD_ID,
  WELCOME_LOG_CHANNEL_ID: process.env.WELCOME_LOG_CHANNEL_ID,
  EVENT_NOTIFICATION_CHANNEL_ID: process.env.EVENT_NOTIFICATION_CHANNEL_ID,
  YOUTUBE_COOKIES: process.env.YOUTUBE_COOKIES || "",
  BOT_FOOTER: process.env.BOT_FOOTER || "HANEDAN BOT • Created By Lymix",
};

const REQUIRED_ENV = [
  "TOKEN",
  "CLIENT_ID",
  "GUILD_ID",
  "WELCOME_LOG_CHANNEL_ID",
  "EVENT_NOTIFICATION_CHANNEL_ID",
];

const missingEnv = REQUIRED_ENV.filter((key) => !ENV[key]);

if (missingEnv.length) {
  console.error("❌ Eksik Railway Variables:", missingEnv.join(", "));
  process.exit(1);
}

// ======================================================
// HANEDAN ETKİNLİK TAKVİMİ
// ======================================================

const EVENT_TIMEZONE = "Europe/Istanbul";
const EVENT_REMINDER_MINUTES = 10;

// getDay(): 0=Pazar, 1=Pazartesi, ... 6=Cumartesi
const HANEDAN_EVENTS = [
  // Pazartesi
  { day: 1, time: "20:50", name: "Karakter Turnuvası", emoji: "⚔️" },
  { day: 1, time: "22:25", name: "ARENA", emoji: "🏟️" },

  // Salı
  { day: 2, time: "20:50", name: "Karakter Turnuvası", emoji: "⚔️" },
  { day: 2, time: "22:25", name: "ARENA", emoji: "🏟️" },

  // Çarşamba
  { day: 3, time: "20:50", name: "Karakter Turnuvası", emoji: "⚔️" },
  { day: 3, time: "22:25", name: "3 İmparatorluk", emoji: "👑" },

  // Perşembe
  { day: 4, time: "20:50", name: "Karakter Turnuvası", emoji: "⚔️" },
  { day: 4, time: "22:25", name: "ARENA", emoji: "🏟️" },

  // Cuma
  { day: 5, time: "20:50", name: "Karakter Turnuvası", emoji: "⚔️" },
  { day: 5, time: "22:25", name: "ARENA", emoji: "🏟️" },

  // Cumartesi
  { day: 6, time: "22:25", name: "3 İmparatorluk", emoji: "👑" },

  // Pazar
  { day: 0, time: "22:25", name: "ARENA", emoji: "🏟️" },
];

const DAY_NAMES_TR = [
  "Pazar",
  "Pazartesi",
  "Salı",
  "Çarşamba",
  "Perşembe",
  "Cuma",
  "Cumartesi",
];

const sentEventReminders = new Set();

function getIstanbulNowParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: EVENT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  );

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    day: weekdayMap[parts.weekday],
    time: `${parts.hour}:${parts.minute}`,
  };
}

function subtractMinutesFromTime(hhmm, minutes) {
  const [h, m] = hhmm.split(":").map(Number);
  let total = h * 60 + m - minutes;
  total = ((total % 1440) + 1440) % 1440;

  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60
  ).padStart(2, "0")}`;
}

async function checkEventReminders() {
  try {
    if (!client.isReady()) return;

    const guild = client.guilds.cache.get(ENV.GUILD_ID);
    if (!guild) return;

    const channel = await fetchChannel(
      guild,
      ENV.EVENT_NOTIFICATION_CHANNEL_ID
    );

    if (!channel || !channel.isTextBased()) return;

    const now = getIstanbulNowParts();

    for (const event of HANEDAN_EVENTS) {
      const reminderTime = subtractMinutesFromTime(
        event.time,
        EVENT_REMINDER_MINUTES
      );

      if (now.day !== event.day || now.time !== reminderTime) continue;

      const dedupeKey = `${now.date}:${event.day}:${event.time}:${event.name}`;
      if (sentEventReminders.has(dedupeKey)) continue;

      sentEventReminders.add(dedupeKey);

      const embed = withFooter(
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${event.emoji} ${event.name.toUpperCase()} YAKLAŞIYOR!`)
          .setDescription(
            [
              `⏰ **${event.name} etkinliğine ${EVENT_REMINDER_MINUTES} dakika kaldı!**`,
              `🕒 **Etkinlik Saati:** ${event.time} (Türkiye Saati)`,
              `📅 **Gün:** ${DAY_NAMES_TR[event.day]}`,
              "",
              "🔥 **Toparlanın!**",
            ].join("\n")
          )
      );

      await channel.send({
        content: "@everyone",
        embeds: [embed],
        allowedMentions: { parse: ["everyone"] },
      });

      console.log(
        `📣 Etkinlik bildirimi: ${DAY_NAMES_TR[event.day]} ${event.time} ${event.name}`
      );

      // Set'in şişmesini önlemek için eski gün kayıtlarını temizle.
      for (const key of sentEventReminders) {
        if (!key.startsWith(now.date)) {
          sentEventReminders.delete(key);
        }
      }
    }
  } catch (error) {
    console.error("❌ Etkinlik bildirimi hatası:", error);
  }
}

// ======================================================
// CLIENT + MUSIC
// ======================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

const musicPlayer = new Player(client, {
  skipFFmpeg: false,
});

setFFmpegPath("/usr/bin/ffmpeg");
setYtDlpPath("yt-dlp");

musicPlayer.events.on("error", (queue, error) => {
  console.error("❌ MÜZİK QUEUE ERROR:", {
    guildId: queue?.guild?.id || null,
    message: error?.message || String(error),
  });
});

musicPlayer.events.on("playerError", (queue, error, track) => {
  console.error("❌ MÜZİK PLAYER ERROR:", {
    guildId: queue?.guild?.id || null,
    track: track?.title || track?.url || null,
    message: error?.message || String(error),
  });
});

// ======================================================
// HELPERS
// ======================================================

function withFooter(embed) {
  return embed
    .setFooter({ text: ENV.BOT_FOOTER })
    .setTimestamp();
}

function errorEmbed(title, description) {
  return withFooter(
    new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(title)
      .setDescription(description)
  );
}

async function fetchChannel(guild, channelId) {
  return (
    guild.channels.cache.get(channelId) ||
    (await guild.channels.fetch(channelId).catch(() => null))
  );
}

// ======================================================
// YOUTUBE COOKIES + DIRECT yt-dlp STREAM
// ======================================================

const YOUTUBE_COOKIE_FILE = "/tmp/lymix-youtube-cookies.txt";

function prepareYouTubeCookies() {
  const raw = ENV.YOUTUBE_COOKIES;

  if (!raw || !raw.trim()) {
    console.warn("⚠️ YOUTUBE_COOKIES ayarlı değil.");
    return null;
  }

  try {
    const normalized = raw.replace(/\r\n/g, "\n").trim() + "\n";

    fs.writeFileSync(YOUTUBE_COOKIE_FILE, normalized, {
      encoding: "utf8",
      mode: 0o600,
    });

    return YOUTUBE_COOKIE_FILE;
  } catch (error) {
    console.error("❌ Cookie dosyası oluşturulamadı:", error?.message || error);
    return null;
  }
}

function createYtDlpAudioStream(url) {
  const cookieFile = prepareYouTubeCookies();

  const args = [
    "--no-playlist",
    "--no-warnings",
    "--quiet",

    // YouTube'un güncel JS challenge sistemi için.
    "--js-runtimes",
    "node",
    "--remote-components",
    "ejs:github",

    ...(cookieFile ? ["--cookies", cookieFile] : []),

    "-f",
    "bestaudio[protocol^=http]/bestaudio/best",
    "-o",
    "-",
    url,
  ];

  console.log("▶️ yt-dlp stream:", url);

  const proc = spawn("yt-dlp", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";

  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 3000) stderr = stderr.slice(-3000);
  });

  proc.on("error", (error) => {
    console.error("❌ yt-dlp process error:", error?.message || error);
  });

  proc.on("close", (code) => {
    if (code !== 0) {
      console.error("❌ yt-dlp çıkış kodu:", code, stderr || "(stderr yok)");
    }
  });

  return proc.stdout;
}

function normalizeMusicQuery(query) {
  try {
    const parsed = new URL(query);

    if (parsed.hostname === "music.youtube.com") {
      const videoId = parsed.searchParams.get("v");
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }
  } catch {
    // URL değilse arama metni olarak bırak.
  }

  return query;
}

// ======================================================
// SLASH COMMANDS
// ======================================================

const commands = [
  new SlashCommandBuilder()
    .setName("çal")
    .setDescription("Bulunduğun ses kanalında müzik çalar.")
    .addStringOption((o) =>
      o
        .setName("şarkı")
        .setDescription("Şarkı adı veya YouTube bağlantısı")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("geç")
    .setDescription("Çalan şarkıyı geçer."),

  new SlashCommandBuilder()
    .setName("durdur")
    .setDescription("Müziği durdurur, kuyruğu temizler ve kanaldan çıkar."),

  new SlashCommandBuilder()
    .setName("duraklat")
    .setDescription("Çalan müziği duraklatır."),

  new SlashCommandBuilder()
    .setName("devam")
    .setDescription("Duraklatılan müziği devam ettirir."),

  new SlashCommandBuilder()
    .setName("kuyruk")
    .setDescription("Müzik kuyruğunu gösterir."),

  new SlashCommandBuilder()
    .setName("şimdiçalıyor")
    .setDescription("Şu anda çalan şarkıyı gösterir."),

  new SlashCommandBuilder()
    .setName("etkinlikler")
    .setDescription("HANEDAN haftalık etkinlik programını gösterir."),

  new SlashCommandBuilder()
    .setName("ses")
    .setDescription("Müzik ses seviyesini değiştirir.")
    .addIntegerOption((o) =>
      o
        .setName("seviye")
        .setDescription("1-100 arası ses seviyesi")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),
].map((command) => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(ENV.TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(ENV.CLIENT_ID, ENV.GUILD_ID),
    { body: commands }
  );

  console.log("✅ Slash komutları yüklendi.");
}

// ======================================================
// GELEN / GİDEN
// ======================================================

client.on("guildMemberAdd", async (member) => {
  try {
    const channel = await fetchChannel(
      member.guild,
      ENV.WELCOME_LOG_CHANNEL_ID
    );

    if (!channel || !channel.isTextBased()) return;

    const embed = withFooter(
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("👋 SUNUCUYA KATILDI!")
        .setDescription(`${member}, hoş geldin! 🖤`)
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    );

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("❌ guildMemberAdd:", error);
  }
});

client.on("guildMemberRemove", async (member) => {
  try {
    const channel = await fetchChannel(
      member.guild,
      ENV.WELCOME_LOG_CHANNEL_ID
    );

    if (!channel || !channel.isTextBased()) return;

    const embed = withFooter(
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("👋 SUNUCUDAN AYRILDI!")
        .setDescription(`**${member.user.username}** aramızdan ayrıldı.`)
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    );

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("❌ guildMemberRemove:", error);
  }
});

// ======================================================
// MUSIC COMMAND HANDLER
// ======================================================

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "etkinlikler") {
      const embed = withFooter(
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("📅 HANEDAN ETKİNLİK PROGRAMI")
          .setDescription(
            [
              "🇹🇷 **Tüm saatler Türkiye saatidir.**",
              "",
              "**Pazartesi**",
              "⚔️ 20:50 • Karakter Turnuvası",
              "🏟️ 22:25 • ARENA",
              "",
              "**Salı**",
              "⚔️ 20:50 • Karakter Turnuvası",
              "🏟️ 22:25 • ARENA",
              "",
              "**Çarşamba**",
              "⚔️ 20:50 • Karakter Turnuvası",
              "👑 22:25 • 3 İmparatorluk",
              "",
              "**Perşembe**",
              "⚔️ 20:50 • Karakter Turnuvası",
              "🏟️ 22:25 • ARENA",
              "",
              "**Cuma**",
              "⚔️ 20:50 • Karakter Turnuvası",
              "🏟️ 22:25 • ARENA",
              "",
              "**Cumartesi**",
              "👑 22:25 • 3 İmparatorluk",
              "",
              "**Pazar**",
              "🏟️ 22:25 • ARENA",
            ].join("\n")
          )
      );

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === "çal") {
      const voiceChannel = interaction.member?.voice?.channel;

      if (!voiceChannel) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              "🎵 SES KANALI GEREKLİ",
              "Önce bir ses kanalına gir."
            ),
          ],
          ephemeral: true,
        });
      }

      await interaction.deferReply();

      let query = interaction.options.getString("şarkı");
      query = normalizeMusicQuery(query);

      try {
        const result = await musicPlayer.play(voiceChannel, query, {
          requestedBy: interaction.user,
          nodeOptions: {
            metadata: {
              channelId: interaction.channelId,
              requestedById: interaction.user.id,
            },

            onBeforeCreateStream: async (track) => {
              const url = track?.url || query;

              if (
                typeof url === "string" &&
                (url.includes("youtube.com/") || url.includes("youtu.be/"))
              ) {
                return createYtDlpAudioStream(url);
              }

              return null;
            },

            leaveOnEmpty: true,
            leaveOnEmptyCooldown: 60_000,
            leaveOnEnd: true,
            leaveOnEndCooldown: 60_000,
            leaveOnStop: true,
          },
        });

        const track = result.track;

        const embed = withFooter(
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("🎵 MÜZİĞE EKLENDİ")
            .setDescription(
              `🎶 **${track.title}**\n` +
                `⏱️ Süre: **${
                  track.duration && track.duration !== "0:00"
                    ? track.duration
                    : "Canlı/hesaplanıyor"
                }**\n` +
                `👤 İsteyen: ${interaction.user}`
            )
        );

        if (track.thumbnail) embed.setThumbnail(track.thumbnail);

        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error("❌ /çal:", error);

        return interaction.editReply({
          embeds: [
            errorEmbed(
              "❌ ŞARKI AÇILAMADI",
              "Şarkı bulunamadı veya YouTube bağlantısı açılamadı."
            ),
          ],
        });
      }
    }

    if (interaction.commandName === "geç") {
      const queue = musicPlayer.nodes.get(interaction.guild.id);

      if (!queue?.currentTrack) {
        return interaction.reply({
          embeds: [errorEmbed("🎵 MÜZİK YOK", "Şu anda çalan şarkı yok.")],
          ephemeral: true,
        });
      }

      const title = queue.currentTrack.title;
      queue.node.skip();

      return interaction.reply({
        embeds: [
          withFooter(
            new EmbedBuilder()
              .setColor(0xfee75c)
              .setTitle("⏭️ ŞARKI GEÇİLDİ")
              .setDescription(`**${title}**`)
          ),
        ],
      });
    }

    if (interaction.commandName === "durdur") {
      const queue = musicPlayer.nodes.get(interaction.guild.id);

      if (!queue) {
        return interaction.reply({
          embeds: [errorEmbed("🎵 MÜZİK YOK", "Aktif müzik kuyruğu yok.")],
          ephemeral: true,
        });
      }

      queue.delete();

      return interaction.reply({
        embeds: [
          withFooter(
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle("⏹️ MÜZİK DURDURULDU")
              .setDescription("Kuyruk temizlendi ve bot ses kanalından ayrıldı.")
          ),
        ],
      });
    }

    if (interaction.commandName === "duraklat") {
      const queue = musicPlayer.nodes.get(interaction.guild.id);

      if (!queue?.currentTrack) {
        return interaction.reply({
          embeds: [errorEmbed("🎵 MÜZİK YOK", "Şu anda çalan şarkı yok.")],
          ephemeral: true,
        });
      }

      queue.node.setPaused(true);

      return interaction.reply({
        embeds: [
          withFooter(
            new EmbedBuilder()
              .setColor(0xfee75c)
              .setTitle("⏸️ MÜZİK DURAKLATILDI")
              .setDescription(`**${queue.currentTrack.title}**`)
          ),
        ],
      });
    }

    if (interaction.commandName === "devam") {
      const queue = musicPlayer.nodes.get(interaction.guild.id);

      if (!queue?.currentTrack) {
        return interaction.reply({
          embeds: [errorEmbed("🎵 MÜZİK YOK", "Devam ettirilecek şarkı yok.")],
          ephemeral: true,
        });
      }

      queue.node.setPaused(false);

      return interaction.reply({
        embeds: [
          withFooter(
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle("▶️ MÜZİK DEVAM EDİYOR")
              .setDescription(`**${queue.currentTrack.title}**`)
          ),
        ],
      });
    }

    if (interaction.commandName === "kuyruk") {
      const queue = musicPlayer.nodes.get(interaction.guild.id);

      if (!queue?.currentTrack) {
        return interaction.reply({
          embeds: [errorEmbed("📜 KUYRUK BOŞ", "Şu anda müzik kuyruğu yok.")],
          ephemeral: true,
        });
      }

      const upcoming = queue.tracks.toArray().slice(0, 10);

      const lines = [
        `▶️ **Şimdi:** ${queue.currentTrack.title}`,
        "",
        ...(upcoming.length
          ? upcoming.map(
              (track, index) =>
                `${index + 1}. **${track.title}** • ${track.duration || "?"}`
            )
          : ["📭 Sırada başka şarkı yok."]),
      ];

      return interaction.reply({
        embeds: [
          withFooter(
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle("📜 MÜZİK KUYRUĞU")
              .setDescription(lines.join("\n"))
          ),
        ],
      });
    }

    if (interaction.commandName === "şimdiçalıyor") {
      const queue = musicPlayer.nodes.get(interaction.guild.id);
      const track = queue?.currentTrack;

      if (!track) {
        return interaction.reply({
          embeds: [errorEmbed("🎵 MÜZİK YOK", "Şu anda çalan şarkı yok.")],
          ephemeral: true,
        });
      }

      const embed = withFooter(
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("🎶 ŞİMDİ ÇALIYOR")
          .setDescription(
            `**${track.title}**\n` +
              `⏱️ Süre: **${track.duration || "Bilinmiyor"}**\n` +
              (track.requestedBy
                ? `👤 İsteyen: ${track.requestedBy}`
                : "")
          )
      );

      if (track.thumbnail) embed.setThumbnail(track.thumbnail);

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === "ses") {
      const queue = musicPlayer.nodes.get(interaction.guild.id);
      const level = interaction.options.getInteger("seviye");

      if (!queue?.currentTrack) {
        return interaction.reply({
          embeds: [errorEmbed("🎵 MÜZİK YOK", "Şu anda çalan şarkı yok.")],
          ephemeral: true,
        });
      }

      queue.node.setVolume(level);

      return interaction.reply({
        embeds: [
          withFooter(
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle("🔊 SES SEVİYESİ")
              .setDescription(`Ses seviyesi **%${level}** yapıldı.`)
          ),
        ],
      });
    }
  } catch (error) {
    console.error("❌ Interaction error:", error);

    const payload = {
      embeds: [
        errorEmbed(
          "❌ BEKLENMEYEN HATA",
          "İşlem sırasında bir hata oluştu. Railway loglarını kontrol et."
        ),
      ],
      ephemeral: true,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

// ======================================================
// READY + START
// ======================================================

client.once("clientReady", () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`🤖 HANEDAN BOT aktif: ${client.user.tag}`);
  console.log("🎵 Müzik sistemi: ONLINE");
  console.log("👋 Gelen / Giden sistemi: ONLINE");
  console.log("📅 Etkinlik sistemi: ONLINE (Europe/Istanbul)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  checkEventReminders();
  setInterval(checkEventReminders, 30_000);
});

async function start() {
  try {
    console.log("🚀 Bot başlatılıyor...");
    console.log(
      `🍪 YOUTUBE_COOKIES: ${ENV.YOUTUBE_COOKIES ? "AYARLI" : "YOK"}`
    );

    await musicPlayer.extractors.loadMulti(DefaultExtractors);

    await musicPlayer.extractors.register(YouTubeDlpExtractor, {
      debug: false,
      searchLimit: 3,
      ytdlpTimeoutMs: 30000,
    });

    console.log("▶️ YouTube yt-dlp extractor hazır.");

    await client.login(ENV.TOKEN);

    registerCommands().catch((error) => {
      console.error("❌ Slash komutları yüklenemedi:", error);
    });
  } catch (error) {
    console.error("❌ BOT BAŞLATILAMADI:", error);
    process.exit(1);
  }
}

start();
