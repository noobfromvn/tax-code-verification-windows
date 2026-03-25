# Tax Code Verification for Windows

Ứng dụng desktop Windows/Electron được xây lại từ extension Chrome `tax-code-verification`, với mục tiêu giữ luồng sử dụng và hành vi nghiệp vụ sát nhất có thể.

## Nguồn tham chiếu
Repo gốc dùng để phân tích và đối chiếu hành vi:
- https://github.com/kyimmQ/tax-code-verification

## Chức năng chính
- Mở file Excel `.xlsx` / `.xls`
- Tự nhận diện cột **CCCD**, **MST**, **Đồng bộ CCCD**
- Tra cứu theo 2 pha: **CCCD -> MST fallback**
- Xử lý CAPTCHA bằng **Tesseract.js** cục bộ
- Tạm dừng / tiếp tục / dừng hàng đợi
- Xuất file Excel kết quả
- Hỗ trợ proxy runtime ngay trong giao diện app
- Giao diện responsive hơn khi resize cửa sổ

## Cài đặt
Yêu cầu:
- Windows 10/11
- Node.js 20+ hoặc 22+
- Kết nối mạng truy cập được cổng tra cứu thuế

Cài dependency:
```bash
npm install
```

Chạy ứng dụng:
```bash
npm start
```

Build bộ cài Windows:
```bash
npm run build:win
```

## Cách dùng
1. Mở app
2. Chọn file Excel
3. Kiểm tra mapping cột
4. Nếu cần, mở **Settings / Proxy** để cấu hình proxy runtime
5. Bấm **Tải danh sách**
6. Bấm **Bắt đầu** để chạy tra cứu
7. Xuất file kết quả khi hoàn tất

## Proxy runtime
App hỗ trợ 3 chế độ proxy cho phần tra cứu:
- **System**: dùng cấu hình proxy hệ điều hành
- **Manual**: nhập proxy thủ công và bypass rules
- **Direct**: bỏ qua proxy

Cấu hình được lưu lại để dùng cho các lần mở app sau.

## OCR / CAPTCHA
- CAPTCHA được lấy từ trang tra cứu và OCR cục bộ bằng `tesseract.js`
- File traineddata đã được bundle sẵn trong project:
  - `assets/tesseract/eng.traineddata.gz`
- Ở bản packaged, traineddata được unpack để worker có thể đọc trực tiếp từ filesystem

## Log debug
Khi cần debug OCR hoặc lỗi mạng:
- xem console nơi chạy `npm start`
- hoặc xem file `debug.log` trong thư mục `userData` của ứng dụng

Các prefix log chính:
- `[tesseract]`
- `[network]`

## Cấu trúc chính
```text
src/
  main/
  renderer/
assets/tesseract/
README.md
APP-NOTES.md
```

## Ghi chú parity
Bản desktop này giữ rất sát các phần cốt lõi của extension gốc:
- luồng chọn file -> map cột -> tải danh sách -> bắt đầu -> xuất Excel
- tra cứu 2 pha CCCD -> MST
- OCR CAPTCHA cục bộ
- xử lý retry
- export nhiều dòng khi có multi-match

Khác biệt chính còn lại là ứng dụng desktop không có vòng đời/background giống hệt extension trình duyệt.
