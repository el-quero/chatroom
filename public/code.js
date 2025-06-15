(function () {
  const app = document.querySelector(".app");
  const socket = io();

  let uname = "";
  let userRole = "";
  let onlineUsers = new Set();

  socket.on("online-status-update", (onlineList) => {
    onlineUsers = new Set(onlineList);
    // Jika daftar anggota sedang tampil, refresh supaya status updated
    if (!app.querySelector(".members-popup").classList.contains("hidden")) {
      loadMembers();
    }
  });

  const menuToggle = app.querySelector("#menu-toggle");
  const dropdownMenu = app.querySelector(".dropdown-menu");

  menuToggle.addEventListener("click", () => {
    dropdownMenu.classList.toggle("show");
  });

  app.querySelector("#show-members").addEventListener("click", () => {
    loadMembers();
    dropdownMenu.classList.remove("show");
  });

  app.querySelector("#clear-chat").addEventListener("click", async () => {
    dropdownMenu.classList.remove("show");
    if (!uname) {
      alert("Anda perlu login untuk menghapus chat.");
      return;
    }
    if (!confirm("Apakah Anda yakin ingin menghapus semua chat?")) return;

    try {
      const res = await fetch("/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminName: uname }),
      });
      const result = await res.json();
      if (res.ok) {
        alert(result.message);
        app.querySelector(".messeges").innerHTML = "";
      } else {
        alert(result.message || "Gagal menghapus chat.");
      }
    } catch (err) {
      alert("Kesalahan saat menghapus chat.");
      console.error(err);
    }
  });

  app.querySelector("#exit-chat").addEventListener("click", () => {
    dropdownMenu.classList.remove("show");
    socket.emit("exituser", uname);
    window.location.reload();
  });

  // Tombol "Masuk"
  app.querySelector("#join-user").addEventListener("click", async function () {
    const username = app.querySelector("#username").value.trim();
    const password = app.querySelector("#password").value.trim();
    const loginStatus = app.querySelector("#login-status");

    if (!username || !password) {
      loginStatus.innerText = "Nama dan password wajib diisi.";
      return;
    }

    try {
      const res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: username, password }),
      });

      const result = await res.json();

      if (res.ok) {
        uname = username;
        userRole = result.role || "member";

        if (result.isNewUser) {
          socket.emit("newuser", uname); // akan munculkan 'join the club'
        } else {
          socket.emit("userlogin", uname); // hanya masuk, tanpa 'join the club'
        }

        // Ganti tampilan ke chat screen
        app.querySelector(".join-screen").classList.remove("active");
        app.querySelector(".chat-screen").classList.add("active");

        // Tampilkan pesan selamat datang di area chat
        const container = app.querySelector(".messeges");
        const welcome = document.createElement("div");
        welcome.className = "update";
        welcome.innerText = result.message;
        container.appendChild(welcome);
        container.scrollTop = container.scrollHeight;

        loginStatus.innerText = "";
      } else {
        loginStatus.innerText = result.message || "Gagal masuk.";
      }
    } catch (err) {
      loginStatus.innerText = "Gagal terhubung ke server.";
      console.error(err);
    }
  });

  // Kirim pesan
  app.querySelector("#send-messege").addEventListener("click", function () {
    const message = app.querySelector("#messege-input").value.trim();
    if (message.length === 0) return;

    renderMessage("my", { username: uname, text: message });

    socket.emit("chat", {
      username: uname,
      text: message,
    });

    app.querySelector("#messege-input").value = "";
  });

  // Keluar dari chat
  app.querySelector("#exit-chat").addEventListener("click", function () {
    socket.emit("exituser", uname);
    window.location.reload();
  });

  // Terima pesan dan update status
  socket.on("update", function (update) {
    renderMessage("update", update);
  });

  socket.on("chat", function (message) {
    renderMessage("other", message);
  });

  // Fungsi render pesan
  function renderMessage(type, message) {
    const container = app.querySelector(".messeges");
    const el = document.createElement("div");

    if (type === "my") {
      el.className = "messege my-messege";
      el.innerHTML = `
        <div>
          <div class="name">Kamu</div>
          <div class="text">${sanitizeHTML(message.text)}</div>
        </div>`;
    } else if (type === "other") {
      el.className = "messege other-messege";
      el.innerHTML = `
        <div>
          <div class="name">${sanitizeHTML(message.username)}</div>
          <div class="text">${sanitizeHTML(message.text)}</div>
        </div>`;
    } else if (type === "update") {
      el.className = "update";
      el.innerText = message;
    }

    container.appendChild(el);
    container.scrollTop = container.scrollHeight - container.clientHeight;
  }

  // Simple sanitize to prevent injection
  function sanitizeHTML(str) {
    return str.replace(/[&<>"']/g, function (m) {
      return (
        {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[m] || m
      );
    });
  }

  const showMembersBtn = app.querySelector("#show-members");
  const membersPopup = app.querySelector(".members-popup");
  const membersList = app.querySelector("#members-list");
  const closeMembersBtn = app.querySelector("#close-members");

  showMembersBtn.addEventListener("click", loadMembers);
  closeMembersBtn.addEventListener("click", () => {
    membersPopup.classList.add("hidden");
    removeExistingMenus();
  });

  async function loadMembers() {
    try {
      const res = await fetch("/members");
      const data = await res.json();

      membersList.innerHTML = "";

      data.members.forEach((member) => {
        const li = document.createElement("li");
        li.classList.add("member-item");

        // Format nama dan role
        const nameSpan = document.createElement("span");
        nameSpan.textContent = member.name;
        nameSpan.classList.add("member-name");

        // Buat indicator status online/offline
        const statusSpan = document.createElement("span");
        statusSpan.classList.add("member-status");
        statusSpan.title = onlineUsers.has(member.name) ? "Online" : "Offline";
        statusSpan.style.marginLeft = "6px";
        statusSpan.style.width = "10px";
        statusSpan.style.height = "10px";
        statusSpan.style.borderRadius = "50%";
        statusSpan.style.display = "inline-block";
        statusSpan.style.backgroundColor = onlineUsers.has(member.name)
          ? "limegreen"
          : "gray";

        // Gabungkan nama dan status indicator di container span
        const nameContainer = document.createElement("span");
        nameContainer.style.display = "flex";
        nameContainer.style.alignItems = "center";

        nameContainer.appendChild(nameSpan);
        nameContainer.appendChild(statusSpan);

        const roleSpan = document.createElement("span");
        roleSpan.textContent = member.role;
        roleSpan.classList.add("member-role");

        li.appendChild(nameContainer);
        li.appendChild(roleSpan);

        // Jika member atau co-admin, tambahkan tombol titik tiga
        if (member.role === "member" || member.role === "co-admin") {
          const menuBtn = document.createElement("button");
          menuBtn.className = "menu-button";
          menuBtn.setAttribute("aria-label", "Menu member options");
          menuBtn.textContent = "⋮";
          menuBtn.title = "Options";
          menuBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            showMemberMenu(member, li, menuBtn);
          });
          li.appendChild(menuBtn);
        }

        membersList.appendChild(li);
      });

      membersPopup.classList.remove("hidden");
    } catch (err) {
      alert("Gagal mengambil daftar anggota.");
      console.error(err);
    }
  }

  // Tampilkan menu opsi titik tiga sesuai role
  function showMemberMenu(member, listItem, button) {
    removeExistingMenus();

    const menu = document.createElement("div");
    menu.className = "member-menu";

    const canDelete = userRole === "admin" || userRole === "co-admin";
    const canChangeRole = userRole === "admin";

    if (canDelete) {
      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Hapus Member";
      deleteBtn.className = "menu-item delete-option";
      deleteBtn.addEventListener("click", async () => {
        if (confirm(`Anda yakin ingin menghapus anggota: ${member.name} ?`)) {
          try {
            const res = await fetch("/delete-member", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                adminName: uname,
                targetName: member.name,
              }),
            });
            const result = await res.json();
            if (res.ok) {
              alert(result.message);
              loadMembers();
            } else {
              alert(result.message || "Gagal menghapus anggota.");
            }
          } catch (err) {
            alert("Kesalahan saat menghapus anggota.");
            console.error(err);
          }
        }
        removeExistingMenus();
      });
      menu.appendChild(deleteBtn);
    }

    if (canChangeRole) {
      const changeRoleBtn = document.createElement("button");
      if (member.role === "member") {
        changeRoleBtn.textContent = "Jadikan Co-admin";
        changeRoleBtn.className = "menu-item change-role-option";
        changeRoleBtn.addEventListener("click", async () => {
          try {
            const res = await fetch("/change-role", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                adminName: uname,
                targetName: member.name,
                newRole: "co-admin",
              }),
            });
            const result = await res.json();
            if (res.ok) {
              alert(result.message);
              loadMembers();
            } else {
              alert(result.message || "Gagal mengubah role.");
            }
          } catch (err) {
            alert("Kesalahan saat mengubah role.");
            console.error(err);
          }
          removeExistingMenus();
        });
      } else if (member.role === "co-admin") {
        changeRoleBtn.textContent = "Jadikan Member";
        changeRoleBtn.className = "menu-item change-role-option";
        changeRoleBtn.addEventListener("click", async () => {
          try {
            const res = await fetch("/change-role", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                adminName: uname,
                targetName: member.name,
                newRole: "member",
              }),
            });
            const result = await res.json();
            if (res.ok) {
              alert(result.message);
              loadMembers();
            } else {
              alert(result.message || "Gagal mengubah role.");
            }
          } catch (err) {
            alert("Kesalahan saat mengubah role.");
            console.error(err);
          }
          removeExistingMenus();
        });
      }
      menu.appendChild(changeRoleBtn);
    }

    listItem.appendChild(menu);

    function closeOnClickOutside(event) {
      if (!menu.contains(event.target) && event.target !== button) {
        removeExistingMenus();
        document.removeEventListener("click", closeOnClickOutside);
      }
    }
    document.addEventListener("click", closeOnClickOutside);
  }

  function removeExistingMenus() {
    document.querySelectorAll(".member-menu").forEach((menu) => {
      menu.remove();
    });
  }
})();
