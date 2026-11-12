# The app window

The library opens as an app, not as a tab among others. A small server runs behind it on your computer, but it is hidden: there is no window with a port number.

## How it starts

Click the "Library" shortcut (desktop or Start menu). The launcher:

1. starts the server hidden;
2. opens its own window of Edge, Chrome, Chromium or Brave (app mode, no address bar);
3. watches the window.

## How it stops

**Close the window** and the server stops by itself. You can also use the button **Quit the library** in the left menu (visible when the program was started with the shortcut).

If no suitable browser exists, the library opens in the default browser. The server then stops about 30 seconds after you close the last tab with it.

## The second time

If the library is already running and you click the shortcut again, only a new window to the same server opens.

## The mode

At the bottom of the menu you see **Normal mode** or **Safe mode**. Click it for an explanation and a switch ([details](#/docs/safe-mode)).

## Where the traces are

The server log is the file `outputs/server.log` (in the library folder). It shows why something did not start and which mode was used. If something does not open, start there: [When something does not work](#/docs/troubleshooting).
