# Wedding Fund

Aplikasi pencatatan anggaran pernikahan untuk dua akun Google. Dashboard dan tujuh menu fitur disajikan oleh satu Google Apps Script Web App; Google Sheet adalah sumber data bersama. Repositori ini menyimpan source dan tidak dipakai sebagai GitHub Pages karena aplikasi harus membatasi akses berdasarkan akun Google.

## Struktur upload

Apps Script source berada di root repo supaya `index.html` menjadi entry page dan file `.gs`, HTML, serta manifest mudah di-push atau disinkronkan:

- `index.html`: Dashboard dan halaman awal.
- `Budget.html`, `Transactions.html`, `Checklist.html`, `Vendors.html`, `Savings.html`, `Reports.html`, `Settings.html`: menu fitur.
- `Client.html`: logika tampilan dan pemanggilan backend bersama.
- `Code.gs`: router, otorisasi, validasi, integrasi Sheet, dan API data.
- `appsscript.json`: manifest Apps Script.
- `docs/design.md`: catatan referensi desain Stitch.
- `tools/build-database.mjs`: utilitas pembuat workbook awal.

Semua menu memakai URL Apps Script yang sama dengan parameter halaman. Jangan aktifkan GitHub Pages untuk source ini: source root adalah Apps Script template dan GitHub Pages tidak memberi allowlist dua akun Google. Website yang digunakan adalah deployment GAS.

## Upload manual ke GitHub

1. Buat repository **Private** dan biarkan kosong. Pilih akun pribadi bila repository hanya boleh terlihat oleh Anda dan pasangan; repository milik organisasi dapat memiliki administrator organisasi yang juga bisa mengaksesnya.
2. Dari halaman repository, pilih **Add file → Upload files**. Unggah file source yang ada di root dan folder `docs/` serta `tools/`, lalu commit ke branch `main`. Pertahankan `index.html` di root repository.
3. Bila file dot tidak muncul di pemilih file, tambahkan `.gitignore` dan `.claspignore` sebagai file terpisah. Jangan unggah `.clasp.json`, `.clasprc.json`, `.env`, atau data spreadsheet.
4. Jangan aktifkan GitHub Pages. HTML ini memakai templating dan `google.script.run`, sehingga GitHub menyimpan source saja; jalankan aplikasi melalui deployment GAS.

## Modul dan hubungan data

- `Categories` adalah daftar kategori RAB dengan prioritas. Setup mengisinya dengan nama kategori awal saja; tidak memasukkan transaksi/angka contoh Stitch.
- `Budget` menyimpan rencana nominal per kategori.
- `Transactions` menyimpan pemasukan/pengeluaran, PIC, metode, kategori, vendor, dan tautan bukti. Pengeluaran bertaut kategori menjadi realisasi RAB; transaksi vendor mengurangi sisa kontraknya.
- `Savings` menyimpan setoran, sumber, PIC, rekening, dan verifikasi.
- `Vendors` menyimpan kontrak dan tenggat. Nilai terbayar dihitung dari transaksi vendor, tidak dimasukkan dua kali.
- `Checklist` menyimpan tugas, status, PIC, tenggat, estimasi, kategori, dan vendor.
- `Settings` menyimpan profil pasangan, tanggal acara, target, dan preferensi pengingat.

Aplikasi menyediakan buat/lihat/ubah/hapus, filter PIC/tanggal/pencarian di daftar transaksi dan checklist, tampilan checklist daftar/Kanban/kalender, pembayaran vendor yang otomatis membuat transaksi, ringkasan Dashboard, laporan, CSV, cetak/PDF via browser, dan unduh backup JSON. Tautan bukti disimpan sebagai URL agar aplikasi tidak memerlukan izin Drive.

## Input melalui website atau Google Sheet

Kedua cara memakai tab yang sama. Dari website, gunakan form pada menu. Untuk input langsung di Sheet, gunakan nama kategori/vendor yang tersedia pada kolom `categoryName`/`vendorName`; dropdown membantu memilih nama. Trigger spreadsheet akan mengisi ID relasi, ID baris baru, dan waktu perubahan. Setup membuat tab/header, validasi pilihan PIC/status/jenis/metode, dan kategori awal. Jangan menghapus atau mengganti header.

Kolom hubungan `categoryId`/`vendorId` dan `id` dibuat otomatis oleh aplikasi/trigger. Untuk penghapusan data yang masih dipakai, gunakan website agar perlindungan relasi berjalan; jangan hapus baris kategori/vendor yang masih memiliki transaksi atau tugas.

## Konfigurasi GAS

1. Buka proyek Apps Script standalone yang disiapkan untuk Wedding Fund, lalu masukkan file root `Code.gs`, semua `*.html`, dan `appsscript.json`.
2. Pada Script Properties, isi `SPREADSHEET_ID` dengan ID Sheet Wedding Fund Database dan `ALLOWED_EMAILS` dengan dua akun yang diizinkan, dipisahkan koma. Jangan menaruh email atau ID spreadsheet di source repo.
3. Jalankan `setupDatabase()` dari akun pemilik, setujui scope Spreadsheet, email akun, dan pemasangan trigger spreadsheet. Pastikan zona waktu Asia/Jakarta.
4. Deploy sebagai Web App: execute as **User accessing the web app**, akses **Anyone with a Google account**. Kode tetap menolak semua email di luar allowlist dan menolak bila email kosong.
5. Bagikan Google Sheet sebagai Editor hanya ke akun pasangan. Kedua pengguna perlu izin Sheet karena web app berjalan sebagai pengguna yang login.
6. Setiap perubahan source/access memerlukan versi deployment baru. Bagikan URL `/exec` hanya setelah uji akses dua akun dan penolakan akun lain.

Repositori GitHub harus privat dan hanya mengundang pasangan sebagai kolaborator. Jangan menambahkan `.clasp.json`, token login, Script Properties, atau data transaksi ke repo. `.claspignore` sudah mengikutkan file Apps Script di root saja.

## Pengujian penerimaan

- Tambah/ubah/hapus kategori, anggaran, transaksi, tabungan, vendor, dan checklist; lihat perubahan pada modul terkait dan Dashboard.
- Bayar vendor sebagian dan lunas; pastikan transaksi, nilai terbayar, saldo tagihan, RAB, dan laporan konsisten. Penambahan yang melebihi kontrak harus ditolak.
- Tambahkan kategori, vendor, transaksi, dan tugas langsung di Sheet; pastikan trigger memberi ID dan hubungan nama-ke-ID terbaca di website.
- Uji filter tanggal/PIC, Kanban/kalender, CSV, cetak/PDF, serta backup JSON.
- Uji kedua akun allowlist; akun lain atau email kosong harus ditolak. Bersihkan baris uji setelah selesai.
