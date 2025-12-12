require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 3000;

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI missing in .env");
  process.exit(1);
}

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ Mongo connected"))
  .catch((err) => {
    console.error("❌ Mongo connect error:", err);
    process.exit(1);
  });

app.use((req, res, next) => {
  console.log(`➡️  ${req.method} ${req.url}`);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, sameSite: "lax" },
    store: MongoStore.default.create({
      mongoUrl: MONGODB_URI,
      collectionName: "sessions",
    }),
  })
);

app.use(express.static(path.join(__dirname, "public")));

// ---------- Auth helpers ----------
const isAuthed = (req) => !!req.session.user;

function requirePageAuth(req, res, next) {
  if (!isAuthed(req)) return res.redirect("/login.html");
  next();
}
function requireApiAuth(req, res, next) {
  if (!isAuthed(req)) return res.status(401).json({ error: "Not logged in" });
  next();
}
function requireNotGuest(req, res, next) {
  if (req.session.user?.role === "guest") {
    return res.status(403).json({ error: "Guests cannot modify MongoDB favorites" });
  }
  next();
}

// ---------- Models ----------
const FavoriteSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    cocktailName: { type: String, required: true },
    cocktailImage: { type: String, default: "" },
    moodImage: { type: String, default: "" },
    recipeText: { type: String, default: "" }, // ✅ NEW
  },
  { timestamps: true }
);

// keep your existing collection name
const Favorite = mongoose.model("Favorite", FavoriteSchema, "favourites");

// ---------- Page routes ----------
app.get("/", (req, res) => {
  return res.redirect("/login.html");
});

app.get("/index.html", requirePageAuth, (req, res) => {
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- Auth routes ----------
app.post("/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send("Missing credentials");

  req.session.user = { username, role: "user" };
  return res.redirect("/index.html");
});

app.post("/auth/guest", (req, res) => {
  req.session.user = { username: "Guest", role: "guest" };
  return res.redirect("/index.html");
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    return res.redirect("/login.html");
  });
});

// ---------- API routes ----------
app.get("/api/me", (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ error: "Not logged in" });
  return res.json({ user: req.session.user });
});

// Unsplash proxy
app.get("/api/unsplash", requireApiAuth, async (req, res) => {
  try {
    const key = process.env.UNSPLASH_ACCESS_KEY;
    if (!key) return res.status(500).json({ error: "Missing UNSPLASH_ACCESS_KEY" });

    const q = (req.query.q || "cocktail mood").toString();

    const url = new URL("https://api.unsplash.com/search/photos");
    url.searchParams.set("query", q);
    url.searchParams.set("per_page", "1");
    url.searchParams.set("orientation", "landscape");

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Client-ID ${key}` },
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({ error: "Unsplash failed", details: txt });
    }

    const data = await r.json();
    const first = data?.results?.[0];
    return res.json({ imageUrl: first?.urls?.regular || "" });
  } catch (e) {
    return res.status(500).json({ error: "Unsplash proxy error" });
  }
});

// Favorites (Mongo)
app.get("/api/favorites", requireApiAuth, async (req, res) => {
  try {
    if (req.session.user.role === "guest") return res.json([]);
    const username = req.session.user.username;
    const docs = await Favorite.find({ username }).sort({ createdAt: -1 }).lean();
    return res.json(docs);
  } catch {
    return res.status(500).json({ error: "Failed to load favorites" });
  }
});

app.post("/api/favorites", requireApiAuth, requireNotGuest, async (req, res) => {
  try {
    const username = req.session.user.username;
    const { cocktailName, cocktailImage, moodImage, recipeText } = req.body; // ✅ NEW
    if (!cocktailName) return res.status(400).json({ error: "cocktailName required" });

    const saved = await Favorite.create({
      username,
      cocktailName,
      cocktailImage: cocktailImage || "",
      moodImage: moodImage || "",
      recipeText: recipeText || "", // ✅ NEW
    });

    return res.json({ ok: true, saved });
  } catch (e) {
    return res.status(500).json({ error: "Failed to save favorite" });
  }
});

app.delete("/api/favorites/:id", requireApiAuth, requireNotGuest, async (req, res) => {
  try {
    const username = req.session.user.username;
    const id = req.params.id;

    await Favorite.deleteOne({ _id: id, username });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Failed to delete favorite" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
