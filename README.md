# Wedding Fund

Website Wedding Fund di-host publik melalui GitHub Pages. Semua pengunjung melihat halaman login, tetapi API Google Apps Script hanya memberikan akses spreadsheet setelah username/password cocok. Kredensial tidak pernah ditanam di HTML atau repository.

## File penting

- `index.html`: build statis siap GitHub Pages; navigasi Dashboard, RAB, transaksi, checklist, vendor, tabungan, laporan, dan pengaturan berada dalam satu SPA.
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
4. Jalankan `setupDatabase()` sebagai pemilik spreadsheet untuk menyiapkan tab, header, dropdown, kategori awal, dan trigger input Sheet.
5. Deploy Web App dengan **Execute as me** dan akses **Anyone** (anonymous). Endpoint dapat dijangkau publik, tetapi setiap operasi data mensyaratkan sesi hasil login.
6. Masukkan URL deployment `/exec` ke `config.js`, build, lalu unggah dua file frontend.

## Data bersama

- `Categories` + `Budget`: kategori dan target biaya.
- `Transactions`: pemasukan/pengeluaran, kategori, PIC, vendor, bukti; menjadi realisasi anggaran.
- `Vendors`: nilai kontrak; jumlah dibayar dan sisa dihitung dari transaksi tertaut.
- `Savings`: setoran tabungan.
- `Checklist`: tugas, PIC, status, tenggat, estimasi, kategori, vendor.
- `Settings`: profil pasangan, tanggal acara, target, preferensi pengingat.

Input web dan input langsung Sheet memakai sumber yang sama. Trigger memberi ID dan menghubungkan kategori/vendor lewat nama.
