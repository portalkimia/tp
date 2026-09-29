# Wedding Fund

Wedding Fund memakai **GitHub Pages sebagai frontend publik** dan **Google Apps Script sebagai backend API**. Pengunjung umum hanya melihat layar login. Hanya dua akun Google yang ditetapkan di allowlist API dapat membaca atau mengubah Google Sheet. Jangan simpan password, token, email allowlist, atau ID spreadsheet di source frontend.

## Struktur source

- `index.html` + `Client.html`: UI dan aplikasi satu halaman; Dashboard, RAB, transaksi, checklist, vendor, tabungan, laporan, dan pengaturan.
- `config.js`: konfigurasi publik berisi Google OAuth Client ID dan URL API GAS; keduanya bukan secret.
- `Code.gs`: backend spreadsheet dan endpoint API, autentikasi ID token Google, serta validasi data.
- `appsscript.json`: Apps Script Web App dijalankan sebagai pemilik deployment, tetapi setiap API memverifikasi ID token Google dan allowlist sebelum akses data.
- `Budget.html`, `Transactions.html`, `Checklist.html`, `Vendors.html`, `Savings.html`, `Reports.html`, `Settings.html`: layar referensi Stitch; runtime aplikasi aktif dirender oleh `Client.html`.
- `github-pages/`: output statis untuk publikasi GitHub Pages.

## Menyiapkan frontend GitHub Pages

1. Jalankan `node tools/build-github-pages.mjs`. Hasilnya ada di folder `github-pages/`.
2. Isi `github-pages/config.js` dengan OAuth Client ID jenis **Web application** dan URL Web App GAS yang berakhiran `/exec`.
3. Unggah **isi** folder `github-pages/` ke root repository yang dipublikasikan GitHub Pages, lalu commit `index.html` dan `config.js`. Jangan upload file root source `index.html` sebelum dibuild. Jangan upload `.clasp.json`, credential, atau spreadsheet.
4. Tambahkan origin situs GitHub Pages yang tepat sebagai **Authorized JavaScript origin** di OAuth Client Google. Untuk repo `tp`, origin umumnya `https://portalkimia.github.io` (tanpa `/tp`).

> GitHub Pages publik menampilkan layar login kepada siapa pun. GitHub Pages bukan halaman privat: pengunjung tetap dapat membuka shell/login. Data tetap ditolak di GAS kecuali token berasal dari salah satu email allowlist. Untuk membatasi akses ke halaman itu sendiri, diperlukan GitHub Enterprise Cloud private Pages atau layanan hosting dengan access gateway.

## Menyiapkan backend GAS satu kali

1. Upload hanya `Code.gs` dan `appsscript.json` ke proyek Apps Script. File HTML **tidak perlu dipasang di GAS**.
2. Atur Script Properties:
   - `SPREADSHEET_ID`: ID spreadsheet Wedding Fund.
   - `ALLOWED_EMAILS`: dua email Google yang diizinkan, dipisah koma.
   - `OAUTH_CLIENT_ID`: OAuth Client ID yang sama dengan frontend.
3. Jalankan `setupDatabase()` sebagai pemilik spreadsheet agar tab, header, dropdown, kategori awal, dan trigger input langsung Sheet disiapkan.
4. Deploy sebagai Web App: **Execute as me** dan akses **Anyone** (anonymous). Endpoint memang dapat dijangkau publik, tetapi tanpa ID token Google yang valid, audience yang cocok, dan email allowlist, operasi data ditolak.
5. Salin URL `/exec` deployment ke `config.js` pada folder `github-pages/`. Jika source GAS berubah, buat deployment version baru.

Jangan mengubah deployment menjadi **execute as user accessing**: frontend GitHub mengirim token identitas Google, bukan sesi cookie Apps Script. Backend harus berjalan sebagai pemilik agar request lintas origin dapat diproses, lalu melakukan verifikasi token dan allowlist sendiri.

## Data dan alur

- `Categories` dan `Budget`: kategori dan target biaya.
- `Transactions`: pemasukan/pengeluaran yang menambah realisasi kategori; pembayaran vendor ditautkan dengan ID vendor.
- `Vendors`: nilai kontrak dan tenggat; jumlah dibayar/sisa dihitung dari transaksi.
- `Savings`: setoran tabungan bersama.
- `Checklist`: tugas, PIC, status, estimasi, kategori, vendor, dan tenggat.
- `Settings`: profil pasangan, tanggal acara, target, dan pengingat aplikasi.

Input melalui website atau langsung pada tab spreadsheet memakai sumber data yang sama. Trigger Sheet menambahkan ID dan menghubungkan kategori/vendor berdasarkan nama. Kedua akun memiliki hak yang sama; PIC hanya label atribusi.

## Pemeriksaan sebelum digunakan

- Uji login kedua akun yang diizinkan; akun Google lain harus ditolak oleh API.
- Coba snapshot, tambah/ubah/hapus baris, pembayaran vendor, dan perubahan lewat Sheet.
- Pastikan sisa kontrak vendor, realisasi kategori, dashboard, laporan, CSV, dan backup sesuai spreadsheet.
- Jangan masukkan data keuangan nyata sebelum deployment baru dan OAuth origin telah dikonfigurasi serta pengujian akses lulus.
