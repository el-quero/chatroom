const express = require("express");
const path = require("path");
const http = require("http");
const sqlite3 = require("sqlite3").verbose();
const socketIo = require("socket.io");
const bcrypt = require("bcrypt");
const onlineUsers = new Set(); // menyimpan username yang sedang online

const SALT_ROUNDS = 10;
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Setup database
const db = new sqlite3.Database("./chat.db", (err) => {
  if (err) console.error("DB error:", err);
  else console.log("Connected to SQLite database");
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      text TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      password TEXT,
      role TEXT DEFAULT 'member'
    )
  `);
});

// 🔐 LOGIN / REGISTER
app.post("/login", (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) {
    return res.status(400).json({ message: "Nama dan password wajib diisi" });
  }

  db.get("SELECT * FROM users WHERE name = ?", [name], async (err, row) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ message: "Kesalahan server" });
    }

    if (!row) {
      // Cek jumlah user di database
      db.get("SELECT COUNT(*) as count FROM users", async (err2, countRow) => {
        if (err2) {
          return res.status(500).json({ message: "Kesalahan server" });
        }

        const role = countRow.count === 0 ? "admin" : "member"; // user pertama jadi admin

        try {
          const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
          db.run(
            "INSERT INTO users (name, password, role) VALUES (?, ?, ?)",
            [name, hashedPassword, role],
            (err3) => {
              if (err3) {
                console.error("Insert error:", err3);
                return res.status(500).json({ message: "Gagal membuat akun" });
              }
              return res.json({
                message: `Berhasil masuk dan akun dibuat dengan role ${role}`,
                role,
                isNewUser: true, // ✅ Tambah flag ini
              });
            }
          );
        } catch (err) {
          return res
            .status(500)
            .json({ message: "Gagal mengenkripsi password" });
        }
      });
    } else {
      // Akun sudah ada, cocokkan password
      try {
        const match = await bcrypt.compare(password, row.password);
        if (match) {
          return res.json({
            message: `Berhasil masuk, halo ${row.name}`,
            role: row.role,
            isNewUser: false, // ✅ Tambah flag ini
          });
        } else {
          return res.status(401).json({
            message: "Nama atau password salah / nama pernah digunakan",
          });
        }
      } catch {
        return res
          .status(500)
          .json({ message: "Kesalahan saat memeriksa password" });
      }
    }
  });
});

// 🔧 Hapus semua chat (hanya admin)
app.post("/clear", (req, res) => {
  const { adminName } = req.body; // Dapatkan username admin dari body request
  if (!adminName) {
    return res.status(400).json({ message: "adminName wajib disertakan" });
  }

  // Cek role user di DB
  db.get("SELECT role FROM users WHERE name = ?", [adminName], (err, row) => {
    if (err) {
      return res.status(500).json({ message: "Kesalahan server" });
    }
    if (!row || row.role !== "admin") {
      return res
        .status(403)
        .json({ message: "Hanya admin yang dapat menghapus chat" });
    }

    // Jika admin, hapus semua pesan
    db.run("DELETE FROM messages", (err) => {
      if (err) {
        console.error("Error deleting messages:", err);
        return res.status(500).json({ message: "Gagal menghapus pesan." });
      }
      return res.json({ message: "Semua pesan berhasil dihapus." });
    });
  });
});

// 📥 Ambil daftar anggota dari database dengan role
app.get("/members", (req, res) => {
  db.all(
    "SELECT name, role FROM users ORDER BY role DESC, name ASC",
    [],
    (err, rows) => {
      if (err) {
        console.error("Error fetching members:", err);
        return res
          .status(500)
          .json({ message: "Gagal mengambil data anggota." });
      }

      // Map rows to objects { name, role }
      const members = rows.map((row) => ({ name: row.name, role: row.role }));
      res.json({ members });
    }
  );
});

// 🔌 Socket.IO
io.on("connection", (socket) => {
  console.log("User  connected");

  // Saat login
  socket.on("newuser", (username) => {
    socket.username = username; // Simpan username di socket
    onlineUsers.add(username);
    socket.broadcast.emit("update", `${username} join the club`);
    io.emit("online-status-update", Array.from(onlineUsers)); // broadcast status online terbaru
  });

  socket.on("userlogin", (username) => {
    socket.username = username;
    onlineUsers.add(username);
    io.emit("online-status-update", Array.from(onlineUsers)); // tanpa broadcast pesan
  });

  socket.on("exituser", (username) => {
    if (socket.hasExited) return; // ✅ Cegah pemrosesan ganda
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

  // Bagian kirim pesan dan load history sama seperti sebelumnya
  db.all("SELECT name, text FROM messages ORDER BY id ASC", [], (err, rows) => {
    if (!err && rows) {
      rows.forEach((row) => {
        socket.emit("chat", { username: row.name, text: row.text });
      });
    }
  });

  socket.on("chat", (message) => {
    const username = message.username || "Anon";
    const text = message.text || "";

    db.run(
      "INSERT INTO messages (name, text) VALUES (?, ?)",
      [username, text],
      (err) => {
        if (err) console.error("Insert error:", err);
      }
    );

    socket.broadcast.emit("chat", { username, text });
  });
});

// Endpoint untuk mengubah role (admin only)
app.post("/change-role", (req, res) => {
  const { adminName, targetName, newRole } = req.body;

  if (!adminName || !targetName || !newRole) {
    return res.status(400).json({ message: "Data tidak lengkap." });
  }

  db.get("SELECT role FROM users WHERE name = ?", [adminName], (err, row) => {
    if (err) {
      return res.status(500).json({ message: "Kesalahan server." });
    }
    if (!row || row.role !== "admin") {
      return res.status(403).json({
        message: "Akses ditolak. Hanya admin yang dapat mengubah role.",
      });
    }

    // Jangan izinkan ubah role admin
    if (targetName === adminName) {
      return res
        .status(400)
        .json({ message: "Admin tidak bisa mengubah rolenya sendiri." });
    }

    db.run(
      "UPDATE users SET role = ? WHERE name = ?",
      [newRole, targetName],
      (err) => {
        if (err) {
          return res.status(500).json({ message: "Gagal mengubah role." });
        }
        io.emit("update", `${targetName} role changed to ${newRole}`);
        return res.json({ message: "Role berhasil diubah." });
      }
    );
  });
});

// Endpoint untuk menghapus anggota (admin dan co-admin)
app.post("/delete-member", (req, res) => {
  const { adminName, targetName } = req.body;

  if (!adminName || !targetName) {
    return res.status(400).json({ message: "Data tidak lengkap." });
  }

  db.get("SELECT role FROM users WHERE name = ?", [adminName], (err, row) => {
    if (err) {
      return res.status(500).json({ message: "Kesalahan server." });
    }
    if (!row || (row.role !== "admin" && row.role !== "co-admin")) {
      return res.status(403).json({
        message:
          "Akses ditolak. Hanya admin/co-admin yang dapat menghapus anggota.",
      });
    }

    // Jangan izinkan hapus admin
    if (targetName === adminName) {
      return res
        .status(400)
        .json({ message: "Anda tidak bisa menghapus diri sendiri." });
    }

    // Cek role target agar tidak hapus admin
    db.get(
      "SELECT role FROM users WHERE name = ?",
      [targetName],
      (err2, row2) => {
        if (err2) {
          return res.status(500).json({ message: "Kesalahan server." });
        }
        if (!row2) {
          return res.status(404).json({ message: "Anggota tidak ditemukan." });
        }
        if (row2.role === "admin") {
          return res.status(403).json({ message: "Admin tidak bisa dihapus." });
        }

        db.run("DELETE FROM users WHERE name = ?", [targetName], (err3) => {
          if (err3) {
            return res
              .status(500)
              .json({ message: "Gagal menghapus anggota." });
          }
          io.emit("update", `${targetName} deleted from the club`);
          return res.json({ message: "Anggota berhasil dihapus." });
        });
      }
    );
  });
});

// 🟢 Jalankan server
server.listen(PORT, "localhost", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
