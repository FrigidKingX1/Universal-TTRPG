' Auto-DM Silent Launcher
' Launches the built Auto-DM executable directly, with no console window.
' Only launches if a build exists - it never triggers a compile silently.

Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

releaseExe = scriptDir & "\src-tauri\target\release\auto-dm.exe"
debugExe = scriptDir & "\src-tauri\target\debug\auto-dm.exe"

If fso.FileExists(releaseExe) Then
    WshShell.Run """" & releaseExe & """", 0, False
ElseIf fso.FileExists(debugExe) Then
    WshShell.Run """" & debugExe & """", 0, False
Else
    ' No build available - surface the regular launcher so the user
    ' sees the error and can choose to build.
    WshShell.Run """" & scriptDir & "\launch-autodm.bat""", 1, False
End If
