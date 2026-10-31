; Cup for Windows — a tiny installer (per user, no admin needed).
; Copyright (c) 2026 Jagadeesh Kumar S. All rights reserved.
Unicode true
SetCompressor /SOLID lzma
!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef SRC
  !define SRC "."
!endif
!ifndef OUT
  !define OUT "Cup-setup.exe"
!endif
Name "Cup"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\Cup"
RequestExecutionLevel user
Icon "${SRC}\cup.ico"
UninstallIcon "${SRC}\cup.ico"
BrandingText "Cup ${VERSION} — by Jagadeesh Kumar S"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Cup"
VIAddVersionKey "CompanyName" "Jagadeesh Kumar S"
VIAddVersionKey "LegalCopyright" "(c) 2026 Jagadeesh Kumar S. All rights reserved."
VIAddVersionKey "FileDescription" "Cup — app store for the Pour package manager"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
LicenseData "${SRC}\LICENSE"
Page license
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Cup"
  SetOutPath "$INSTDIR"
  File "${SRC}\cup.exe"
  File "${SRC}\LICENSE"
  File "${SRC}\THIRD-PARTY-NOTICES.txt"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  CreateShortCut "$SMPROGRAMS\Cup.lnk" "$INSTDIR\cup.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Cup" "DisplayName" "Cup"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Cup" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Cup" "Publisher" "Jagadeesh Kumar S"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Cup" "DisplayIcon" "$INSTDIR\cup.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Cup" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Cup" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Cup" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Cup" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\Cup.lnk"
  Delete "$INSTDIR\cup.exe"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\THIRD-PARTY-NOTICES.txt"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Cup"
SectionEnd
