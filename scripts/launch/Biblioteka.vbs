' Starts the library on Windows without a console window (the shortcuts point here).
' It runs: node scripts\app.js  (hidden). The launcher opens the app window and stops the server when the window closes.
Option Explicit
Dim sh, fso, root, node, pf, code
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
sh.CurrentDirectory = root

node = "node"
pf = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If fso.FileExists(pf) Then
  node = """" & pf & """"
Else
  code = sh.Run("cmd /c where node", 0, True)
  If code <> 0 Then
    MsgBox "Node.js was not found. Run install.cmd again to install it.", 48, "Biblioteka"
    WScript.Quit 1
  End If
End If

sh.Run node & " """ & root & "\scripts\app.js""", 0, False
