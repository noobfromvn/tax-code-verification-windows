# Release Notes

## Current status
Ứng dụng hiện đã có các phần chính sau:
- đọc và map file Excel
- tra cứu 2 pha CCCD -> MST
- OCR CAPTCHA cục bộ
- proxy runtime cấu hình ngay trong app
- giao diện responsive hơn khi resize
- export Excel kết quả

## Technical notes
- Traineddata OCR được bundle local để tránh phụ thuộc tải từ CDN lúc runtime
- App có log debug cho OCR và network
- Packaging đã chuẩn bị để đóng gói traineddata cùng ứng dụng

## Reference
Repo gốc dùng để đối chiếu nghiệp vụ:
- https://github.com/kyimmQ/tax-code-verification
