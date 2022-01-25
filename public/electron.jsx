
// The MAIN process: OUR BACKEND // 

const { app, BrowserWindow, ipcMain, dialog, webContents, session} = require('electron');
const path = require('path');
const fs = require('fs');
const np = require('node-pty');
const os = require('os');
const server = require('../server/server.js');
// react developer tools for electron in dev mode 
const { default: installExtension, REACT_DEVELOPER_TOOLS } = require('electron-devtools-installer');
// global bool to determine if in dev mode or not 
// const isDev = true; 

//Dynamic variable to change terminal type based on os
const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
let mainWindow;
// setup electron window 
function createWindow(params) {
    mainWindow = new BrowserWindow({
        width: 1782,
        height:920,
        backgroundColor: "white",
        icon: path.join(__dirname, 'icon.png'),
        webPreferences:{
            nodeIntegration: true, // changed to true from legacy to resolve an issue with OpenFolderButton
            worldSafeExecuteJavaScript: true,
            contextIsolation: false, // changed to false from legacy to resolve an issue with OpenFolderButton
            webviewTag: true // Electron recommends against using webview, which is why it is disabled by default - could instead build with BrowserView or iframe
        }
    })
    mainWindow.loadFile(path.join(__dirname, 'index.html')); // unsure why we need the path.join, but index.html not found without it


    // PTY PROCESS FOR IN APP TERMINAL
    const ptyArgs = {
        name: 'xterm-color',
        cols: 80,
        rows: 80,
        cwd: process.env.HOME,
        env: process.env,
    };
    console.log("process.env.HOME: ", process.env.HOME);

    const ptyProcess = np.spawn(shell, [], ptyArgs);
    // with ptyProcess, we want to send incoming data to the channel terminal.incData
    ptyProcess.on('data', (data) => {
        mainWindow.webContents.send('terminal.incData', data);
    });
    // in the main process, at terminal.toTerm channel, when data is received,
    // main process will write to ptyProcess
    ipcMain.on('terminal.toTerm', (event, data) => {
        ptyProcess.write(data);
    });
}

// not 100% sure what this is doing 
const isDev = process.env.APP_DEV ? (process.env.APP_DEV.trim() == "true") : false;

if (isDev) {
    require('electron-reload')(__dirname, {
        electron: path.join(__dirname, 'node_modules', '.bin', 'electron')
    });
};

// 
if (os.platform() !== 'win32') {
    const fixPath = require('fix-path'); 
    fixPath(); 
}

// Add react dev tools to electron app 
if (isDev) {
    mainWindow.whenReady().then(() => {
        installExtension(REACT_DEVELOPER_TOOLS, {
            loadExtensionOptions: {
                allowFileAccess: true,
            },
        })
            .then((name) => console.log(`Added Extension:  ${name}`))
            .catch((err) => console.log('An error occurred: ', err));
    });
};


/*
UNIVERSAL IPC CALLS
(The following IPC calls are made from various components in the codebase)
*/
ipcMain.on('Universal.stat', (e, filePath) => {
    e.returnValue = fs.statSync(filePath).isDirectory();
});

ipcMain.on('Universal.readDir', (e, projectFilePath) => {
    e.returnValue = fs.readdirSync(projectFilePath, (err) => {
        if (err) throw err;
    });
});

ipcMain.on('Universal.readFile', (e, filePath) => {
    e.returnValue = fs.readFileSync(filePath, 'utf8', (err) => {
        if (err) throw err;
    });
});

ipcMain.on('Universal.path', (e, folderPath, filePath) => {
    e.returnValue = path.relative(folderPath, filePath, (err) => {
        if (err) throw err;
    });
}); 

// EDITORVIEW.JSX SAVE FILE FUNCTIONALITY
ipcMain.on('EditorView.saveFile', (e, filePath, editedText) => {
    fs.writeFile(filePath, editedText, (err) => {
      if (err) throw err;
    });
    // Return a success message upon save
    e.returnValue = 'Changes Saved';
  });

/*
  EXPORTFILEMODAL.JSX FILE FUNCTIONALITY
  (check existence and create folder)
*/
ipcMain.on('ExportFileModal.exists', (e, fileOrFolderPath) => {
    e.returnValue = fs.existsSync(fileOrFolderPath, (err) => {
        if (err) throw err;
    });
});

ipcMain.on('ExportFileModal.mkdir', (e, folderPath) => {
    e.returnValue = fs.mkdirSync(folderPath, (err) => {
        if (err) throw err;
    });
});

ipcMain.on('ExportFileModal.fileCreate', (e, filePath, file) => {
	e.returnValue = fs.writeFile(filePath, file, (err) => {
		if (err) throw err;
	});
});

ipcMain.on('ExportFileModal.readFile', (e, filePath) => {
	e.returnValue = fs.readFileSync(filePath, 'utf8', (err) => {
		if (err) throw err;
	});
});


// OPENFOLDERBUTTON.JSX FILE FUNCTIONALITY
ipcMain.on('OpenFolderButton.isDirectory', (e, filePath) => {
	e.returnValue = fs.statSync(filePath).isDirectory();
});

ipcMain.on('OpenFolderButton.dialog', (e) => {
	const dialogOptions = {
		properties: ['openDirectory', 'createDirectory'],
		// <-------------------------------------------------------------------------------------------------------------------------------------------->
		// NOTE: The below filters prevented Linux users from being able to choose directories, and therefore from using the app almost entirely.
		// In the interest of the most possible developers being able to use Spearmint, the filters have been removed.
		
		// filters: [
			//     { name: 'Javascript Files', extensions: ['js', 'jsx'] },
			//     { name: 'Style', extensions: ['css'] },
			//     { name: 'Html', extensions: ['html'] }
			// ],
			// <-------------------------------------------------------------------------------------------------------------------------------------------->
			message: 'Please select your project folder',
    };
    e.returnValue = dialog.showOpenDialogSync(dialogOptions);
	});
	
app.whenReady()
        .then(createWindow)
	
// GITHUB FUNCTIONALITY
let githubWindow;
// ipcMain is listening on channel 'Github-Oauth' for an event(user has clicked on github login button)
// ipbMain receives the url from ProjectLoader.jsx line 94
ipcMain.on('Github-Oauth', (event, url) => {
	console.log('opening github oauth window!!')
    githubWindow = new BrowserWindow({
			webPreferences: {
				nodeIntegration: true,
                worldSafeExecuteJavaScript: true,
				contextIsolation: false,
                webviewTag: true
			}
		});
		
	githubWindow.loadURL(url)

	// everytime the url navigates to another url, this event will be emitted, and have reference to the new url
	githubWindow.webContents.on('did-navigate', (event, url) => {

		// if the new url matches our final endpoint, then the user has successfully logged in, and we grab the github username via cookies
		if (url.startsWith('http://localhost:3001/auth/github/callback')) {
			// console.log('final localhost url is:', url);

			// gets the cookie with the name property of 'dotcom_user' 
			session.defaultSession.cookies.get({name: 'dotcom_user'})
				.then((cookies) => {

					// if we get cookies with the key of dotcom_user, then send that to the mainWindow's Renderer Process (in this case, the ProjectLoader.jsx)
					if (cookies) mainWindow.webContents.send('github-new-url', cookies);
				})
	
			// close the githubWindow automatically
			githubWindow.close();
		}
	})
})



        


