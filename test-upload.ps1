# Configuration
$apiUrl = "https://chatbot-api-gzl1.onrender.com"
$fichier = "C:\Users\ecom\Desktop\ShopifyApps\test-fichier-brandon.txt"
$responseFile = "C:\Users\ecom\Desktop\ShopifyApps\chatbot-api\upload-response.json"

Write-Host "`n=== 1) Vérification du statut ==="
Invoke-RestMethod "$apiUrl/status"

Write-Host "`n=== 2) Upload du fichier (multipart/form-data) ==="
curl.exe -X POST "$apiUrl/files" `
  -F "file=@$fichier" `
  -o "$responseFile"

Write-Host "`n=== 3) Réponse d'upload ==="
Get-Content "$responseFile"

Write-Host "`n=== 4) Liste des fichiers dans le Vector Store ==="
Invoke-RestMethod "$apiUrl/files"
