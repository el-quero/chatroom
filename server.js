const express = require("express");
const path = require("path");
const http = require("http");
const { Pool } = require("pg");
const socketIo = require("socket.io");
const bcrypt = require("bcrypt");
const onlineUsers = new Set();
require("dotenv").config();

const SALT_ROUNDS = 10;
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// PostgreSQL pool setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Supabase butuh SSL
  },
});

// Buat tabel jika belum ada
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      name TEXT,
      text TEXT,
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE,
      password TEXT,
      role TEXT DEFAULT 'member'
    )
  `);
})();

app.post("/login", async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) {
    return res.status(400).json({ message: "Nama dan password wajib diisi" });
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE name = $1", [
      name,
    ]);
    const row = result.rows[0];

    if (!row) {
      const countResult = await pool.query("SELECT COUNT(*) FROM users");
      const role =
        parseInt(countResult.rows[0].count) === 0 ? "admin" : "member";

      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      await pool.query(
        "INSERT INTO users (name, password, role) VALUES ($1, $2, $3)",
        [name, hashedPassword, role]
      );

      return res.json({
        message: `Berhasil masuk dan akun dibuat dengan role ${role}`,
        role,
        isNewUser: true,
      });
    } else {
      const match = await bcrypt.compare(password, row.password);
      if (match) {
        return res.json({
          message: `Berhasil masuk, halo ${row.name}`,
          role: row.role,
          isNewUser: false,
        });
      } else {
        return res.status(401).json({
          message: "Nama atau password salah / nama pernah digunakan",
        });
      }
    }
  } catch (err) {
    console.error("DB error:", err);
    return res.status(500).json({ message: "Kesalahan server" });
  }
});

app.post("/clear", async (req, res) => {
  const { adminName } = req.body;
  if (!adminName)
    return res.status(400).json({ message: "adminName wajib disertakan" });

  try {
    const result = await pool.query("SELECT role FROM users WHERE name = $1", [
      adminName,
    ]);
    const row = result.rows[0];
    if (!row || row.role !== "admin") {
      return res
        .status(403)
        .json({ message: "Hanya admin yang dapat menghapus chat" });
    }
    await pool.query("DELETE FROM messages");
    return res.json({ message: "Semua pesan berhasil dihapus." });
  } catch (err) {
    return res.status(500).json({ message: "Gagal menghapus pesan." });
  }
});

app.get("/members", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT name, role FROM users ORDER BY role DESC, name ASC"
    );
    const members = result.rows;
    res.json({ members });
  } catch (err) {
    res.status(500).json({ message: "Gagal mengambil data anggota." });
  }
});

io.on("connection", (socket) => {
  console.log("User connected");

  socket.on("newuser", (username) => {
    socket.username = username;
    onlineUsers.add(username);
    socket.broadcast.emit("update", `${username} join the club`);
    io.emit("online-status-update", Array.from(onlineUsers));
  });

  socket.on("userlogin", (username) => {
    socket.username = username;
    onlineUsers.add(username);
    io.emit("online-status-update", Array.from(onlineUsers));
  });

  socket.on("exituser", (username) => {
    if (socket.hasExited) return;
    socket.hasExited = true;
    onlineUsers.delete(username);
    socket.broadcast.emit("update", `${username} left the club`);
    io.emit("online-status-update", Array.from(onlineUsers));
  });

  socket.on("disconnect", () => {
    if (!socket.hasExited && socket.username) {
      onlineUsers.delete(socket.username);
      socket.broadcast.emit("update", `${socket.username} left the club`);
      io.emit("online-status-update", Array.from(onlineUsers));
    }
  });

  (async () => {
    try {
      const result = await pool.query(
        "SELECT name, text FROM messages ORDER BY id ASC"
      );
      result.rows.forEach((row) => {
        socket.emit("chat", { username: row.name, text: row.text });
      });
    } catch {}
  })();

  socket.on("chat", async (message) => {
    const username = message.username || "Anon";
    const text = message.text || "";
    try {
      await pool.query("INSERT INTO messages (name, text) VALUES ($1, $2)", [
        username,
        text,
      ]);
    } catch (err) {
      console.error("Insert error:", err);
    }
    socket.broadcast.emit("chat", { username, text });
  });
});

app.post("/change-role", async (req, res) => {
  const { adminName, targetName, newRole } = req.body;
  if (!adminName || !targetName || !newRole)
    return res.status(400).json({ message: "Data tidak lengkap." });

  try {
    const result = await pool.query("SELECT role FROM users WHERE name = $1", [
      adminName,
    ]);
    const row = result.rows[0];
    if (!row || row.role !== "admin")
      return res.status(403).json({
        message: "Akses ditolak. Hanya admin yang dapat mengubah role.",
      });
    if (targetName === adminName)
      return res
        .status(400)
        .json({ message: "Admin tidak bisa mengubah rolenya sendiri." });
    await pool.query("UPDATE users SET role = $1 WHERE name = $2", [
      newRole,
      targetName,
    ]);
    io.emit("update", `${targetName} role changed to ${newRole}`);
    res.json({ message: "Role berhasil diubah." });
  } catch {
    res.status(500).json({ message: "Gagal mengubah role." });
  }
});

app.post("/delete-member", async (req, res) => {
  const { adminName, targetName } = req.body;
  if (!adminName || !targetName)
    return res.status(400).json({ message: "Data tidak lengkap." });

  try {
    const adminResult = await pool.query(
      "SELECT role FROM users WHERE name = $1",
      [adminName]
    );
    const adminRow = adminResult.rows[0];
    if (
      !adminRow ||
      (adminRow.role !== "admin" && adminRow.role !== "co-admin")
    )
      return res.status(403).json({
        message:
          "Akses ditolak. Hanya admin/co-admin yang dapat menghapus anggota.",
      });
    if (targetName === adminName)
      return res
        .status(400)
        .json({ message: "Anda tidak bisa menghapus diri sendiri." });

    const targetResult = await pool.query(
      "SELECT role FROM users WHERE name = $1",
      [targetName]
    );
    const targetRow = targetResult.rows[0];
    if (!targetRow)
      return res.status(404).json({ message: "Anggota tidak ditemukan." });
    if (targetRow.role === "admin")
      return res.status(403).json({ message: "Admin tidak bisa dihapus." });

    await pool.query("DELETE FROM users WHERE name = $1", [targetName]);
    io.emit("update", `${targetName} deleted from the club`);
    res.json({ message: "Anggota berhasil dihapus." });
  } catch {
    res.status(500).json({ message: "Gagal menghapus anggota." });
  }
});

server.listen(PORT, "localhost", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
