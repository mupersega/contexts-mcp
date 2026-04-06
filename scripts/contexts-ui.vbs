' Contexts UI silent launcher
' - Checks if server is already running on port 3141
' - If not, starts node dist\web.js hidden from the project directory
' - Opens default browser to http://localhost:3141

Option Explicit

Dim WshShell, FSO, projectDir, http, alreadyRunning
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

' Resolve the project directory (parent of the scripts folder this .vbs lives in)
projectDir = FSO.GetParentFolderName(FSO.GetParentFolderName(WScript.ScriptFullName))

alreadyRunning = False
On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.Open "GET", "http://localhost:3141/", False
http.Send
If Err.Number = 0 And http.Status = 200 Then alreadyRunning = True
On Error Goto 0

If Not alreadyRunning Then
    WshShell.CurrentDirectory = projectDir
    WshShell.Run "node dist\web.js", 0, False
    WScript.Sleep 800
End If

WshShell.Run "http://localhost:3141", 1, False
