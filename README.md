# Wedding Fund

Website Wedding Fund di-host publik melalui GitHub Pages. Semua pengunjung melihat halaman login, tetapi API Google Apps Script hanya memberikan akses spreadsheet setelah username/password cocok. Kredensial aktif harus disimpan hanya di Script Properties.

**Pembaruan keamanan:** aplikasi tidak lagi membuat akun/password bawaan. Jika deployment lama masih memakai password contoh `nikah2025`, ganti kedua password di Script Properties sebelum login; password lama tersebut sekarang ditolak. Logout mencabut sesi di server dan menghapus data dari tab browser.

## File penting

- `index.html`: build statis siap GitHub Pages; navigasi Dashboard, RAB, transaksi, checklist, vendor, tabungan, moodboard, laporan, dan pengaturan berada dalam satu SPA.
- `tools/index-shell.html` + `Client.html`: source tampilan dan runtime untuk build.
- `config.js`: URL endpoint GAS (informasi publik, bukan credential).
- `Code.gs`: API dan akses Sheet, login, sesi, validasi, CRUD.
- `appsscript.json`: konfigurasi runtime Web App GAS.
- File modul `Budget.html`, `Transactions.html`, `Checklist.html`, `Vendors.html`, `Savings.html`, `Reports.html`, `Settings.html` mempertahankan referensi desain Stitch.

## Build dan upload GitHub Pages

1. Jalankan `node tools/build-github-pages.mjs`; ini menghasilkan `index.html` root, salinannya di `github-pages/`, dan menyegarkan paket lengkap di `github-upload/`.
2. Pastikan `config.js` berisi URL deployment GAS berakhiran `/exec`, lalu build ulang.
3. Unggah **seluruh isi folder `github-upload/`** ke root repo GitHub (jangan unggah folder `github-upload` sebagai subfolder). Paket itu menyertakan frontend GitHub Pages, source backend GAS, konfigurasi, dokumentasi, dan alat build. Jangan upload `.clasp.json`, password, atau isi spreadsheet.

GitHub Pages menayangkan layar login kepada umum. Username/password dan data Sheet tidak ada di frontend publik; data hanya dilayani GAS setelah sesi valid. Password salah dibatasi percobaannya. Sesi berakhir setelah 6 jam.

## Konfigurasi GAS

1. Upload hanya `Code.gs` dan `appsscript.json` ke proyek GAS. HTML tidak perlu dipasang di GAS.
2. Isi Script Properties:
   - `SPREADSHEET_ID`: ID spreadsheet Wedding Fund.
   - `APP_LOGIN_USER_1`, `APP_LOGIN_PASS_1`: username dan password Anda.
   - `APP_LOGIN_USER_2`, `APP_LOGIN_PASS_2`: username dan password pasangan.
3. Pilih dua password kuat dan berbeda dari password akun Google. Simpan hanya di Script Properties, jangan di source repository.
4. Jalankan `setupDatabase()` sebagai pemilik spreadsheet untuk menyiapkan tab, header, dropdown, kategori awal, dan trigger input Sheet. Fungsi ini tidak lagi membuat kredensial contoh.
5. Deploy Web App dengan **Execute as me** dan akses **Anyone** (anonymous). Endpoint dapat dijangkau publik, tetapi setiap operasi data mensyaratkan sesi hasil login.
6. Masukkan URL deployment `/exec` ke `config.js`, build, lalu unggah dua file frontend.

## Data bersama

- `Categories` + `Budget`: kategori dan target biaya.
- `Transactions`: pemasukan/pengeluaran, kategori, PIC, vendor, bukti; menjadi realisasi anggaran.
- `Vendors`: nilai kontrak; jumlah dibayar dan sisa dihitung dari transaksi tertaut.
- `Savings`: setoran tabungan.
- `Checklist`: tugas, PIC, status, tenggat, estimasi, kategori, vendor.
- `Moodboard`: kartu referensi konsep, gambar, warna, arahan, sumber, urutan, dan vendor tujuan. Tab ini dibuat otomatis saat aplikasi pertama kali dibuka setelah pembaruan.
- `Settings`: profil pasangan, tanggal acara, target, preferensi pengingat, judul konsep, brief, dan palet moodboard.

Input web dan input langsung Sheet memakai sumber yang sama. Trigger memberi ID dan menghubungkan kategori/vendor lewat nama.

## Moodboard untuk vendor

Isi judul tema, gambaran suasana, hal yang harus dihindari, dan kode warna HEX pada halaman **Moodboard**. Tambahkan kartu referensi dengan URL gambar langsung berawalan `https://`, sumber asli, dan catatan yang konkret. Kartu bisa ditujukan ke satu vendor atau ke semua vendor. Pilih vendor pada filter lalu klik **Cetak / Simpan PDF** untuk membuat brief yang hanya berisi arahan umum dan referensi vendor tersebut. Kirim PDF itu secara manual kepada vendor; aplikasi tidak mengirim pesan atau membuka akses spreadsheet untuk vendor. Gambar yang memakai tautan privat hanya akan terlihat oleh orang yang memiliki izin di sumber gambar.

## Aturan perhitungan

- `Savings` mencatat setoran pasangan/keluarga; `Transactions` berjenis pemasukan mencatat dana tambahan seperti hibah. Catat satu penerimaan di salah satu tempat saja agar tidak dihitung dua kali.
- Dana terkumpul = setoran tabungan + pemasukan tambahan. Sisa kebutuhan dana = target RAB dikurangi dana terkumpul, minimal nol. Pengeluaran adalah realisasi biaya; saldo kas saat ini dapat dihitung sebagai dana terkumpul dikurangi pengeluaran.
- Setiap kategori hanya boleh memiliki satu baris RAB baru. Jika Sheet lama sudah mengandung baris ganda, tampilan menjumlahkannya, tetapi hapus atau gabungkan baris duplikat sebelum mengubah anggaran kategori itu.
- Pengingat hanya muncul di aplikasi saat dibuka; pengaturan hari mengatur batas peringatan tugas/tagihan. Tidak ada pengiriman email atau WhatsApp otomatis.

Jalankan `npm test` untuk memeriksa login, logout, validasi anggaran/vendor, filter laporan, dan pengingat tanpa mengubah spreadsheet.
