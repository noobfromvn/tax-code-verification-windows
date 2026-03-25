# App Notes

## Mục tiêu
Tài liệu ngắn gọn cho bản desktop `Tax Code Verification for Windows`.

## Tóm tắt kiến trúc
- **Electron main process**: điều phối app, IPC, proxy runtime, lookup window
- **Renderer**: giao diện người dùng
- **Lookup window**: cửa sổ ẩn dùng để tải trang tra cứu và đọc DOM
- **Tesseract.js**: OCR CAPTCHA cục bộ
- **SheetJS (`xlsx`)**: đọc và ghi Excel

## Luồng xử lý
1. Đọc workbook Excel
2. Tự nhận diện cột cần dùng
3. Tạo queue tra cứu
4. Với mỗi dòng:
   - tra CCCD trước
   - nếu không có kết quả thì fallback sang MST
5. OCR CAPTCHA và submit form tra cứu
6. Ghi kết quả vào bộ nhớ runtime
7. Xuất workbook kết quả

## Dữ liệu kết quả chính
- Đồng bộ CCCD
- Tên NNT
- Cơ quan thuế
- MST Tìm thấy
- Trạng thái MST

## Proxy
Runtime proxy được cấu hình ngay trong app, không phụ thuộc hoàn toàn vào biến môi trường shell.

Các mode hỗ trợ:
- System
- Manual
- Direct

## OCR assets
Local traineddata được bundle tại:
- `assets/tesseract/eng.traineddata.gz`

## Nguồn gốc
Ứng dụng được xây dựa trên phân tích repo gốc:
- https://github.com/kyimmQ/tax-code-verification

## UX cập nhật
- Đóng cửa sổ chính (`X`) trên Windows sẽ trigger một luồng shutdown duy nhất: dispose hidden lookup window, đóng network connections của lookup session, terminate OCR worker nếu đã khởi tạo, rồi exit hẳn process Electron.
- Không còn pattern `hide()` rồi `quit()` khi bấm `X`, để tránh race làm app mất cửa sổ nhưng process vẫn còn sống.
- Có fallback forced-exit ngắn trên non-macOS nếu cleanup bị treo quá lâu; mục tiêu là `npm start` phải trả prompt thay vì để process zombie.
- Giao diện có khối hướng dẫn ngắn ở panel đầu tiên, ngay trên vùng chọn file Excel.
- Có nút `Tải file mẫu` để generate workbook `.xlsx` mẫu qua save dialog của Windows.
