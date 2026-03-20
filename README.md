# Tax Code Verification for Windows

Ứng dụng desktop Windows dùng để tra cứu MST/CCCD từ file Excel, được xây lại dựa trên repo gốc:
- https://github.com/kyimmQ/tax-code-verification

## Tính năng
- Mở file Excel `.xlsx` / `.xls`
- Tự nhận diện cột **CCCD**, **MST**, **Đồng bộ CCCD**
- Tra cứu theo 2 bước: **CCCD -> MST fallback**
- OCR CAPTCHA cục bộ bằng **Tesseract.js**
- Tạm dừng / tiếp tục / dừng quá trình xử lý
- Xuất file Excel kết quả
- Tải **file Excel mẫu** để test nhanh
- Cấu hình **proxy runtime** ngay trong ứng dụng
- Giao diện responsive hơn khi resize cửa sổ
- Đóng cửa sổ chính sẽ thoát app hẳn

## Cách dùng nhanh
1. Mở app
2. Bấm **Tải file mẫu** để test nhanh, hoặc chọn file Excel của bạn
3. Kiểm tra mapping cột
4. Nếu cần, vào **Settings / Proxy** để cấu hình proxy
5. Bấm **Tải danh sách**
6. Bấm **Bắt đầu** để chạy tra cứu
7. Bấm **Xuất Excel** để lưu kết quả

## Proxy
Ứng dụng hỗ trợ 3 chế độ:
- **System**: dùng proxy của hệ điều hành
- **Manual**: nhập proxy thủ công
- **Direct**: không dùng proxy

## Yêu cầu
- Windows 10/11
- Node.js 20+ hoặc 22+
- Truy cập được cổng tra cứu thuế

## Chạy ứng dụng
```bash
npm install
npm start
```

## Build bộ cài Windows
```bash
npm run build:win
```

