const fs = require('fs');
const path = require('path');
const express = require('express');
const spdy = require('spdy');
const send = require('send');
const parseUrl = require('parseurl');
const esprima = require('esprima');

const app = express();
const PORT = 5000;
const CONFIG = {
	key: fs.readFileSync(path.join(__dirname, 'keys/server.key')),
	cert: fs.readFileSync(path.join(__dirname, 'keys/server.crt'))
};
const MIMES = {
	'.html': 'text/html',
	'.js': 'application/javascript'
}

function static(root) {
	return function(req, res, next) {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			// method not allowed
			res.statusCode = 405
			res.setHeader('Allow', 'GET, HEAD')
			res.setHeader('Content-Length', '0')
			res.end()
			return
		}
		let originalUrl = parseUrl.original(req);
		let pathname = parseUrl(req).pathname;
		let extension = path.extname(pathname);

		// make sure redirect occurs at mount
		if (pathname === '/' && originalUrl.pathname.substr(-1) !== '/') {
			pathname = '';
		}
		
		fs.readFile(path.join(root, pathname), (err, data) => {
			// => [Error: EISDIR: illegal operation on a directory, read <directory>]
			if (err) {
				res.statusCode = 404
				res.setHeader('Content-Length', '0')
				res.end()
			} else {
				let content = data.toString();
				let dependencies = [];
				let usesImportExpression = /import .* from/.exec(content);
				if (extension == ".js" && usesImportExpression) {
					esprima.parseModule(content, {}, (node) => {
						if (node.type == "ImportDeclaration") {
							let dependencyRelativePathName = node.source.value;
							let modulePath = path.dirname(pathname);
							dependencies.push({
								'path': path.join(modulePath, dependencyRelativePathName),
								'absPath': path.join(root, modulePath, dependencyRelativePathName),
								'headers': {
									'content-type': 'application/javascript'
								}
							});
						}
					});
				}
				dependencies.forEach(dependency => {
					console.log(`HTTP/2 PUSH'ing ${dependency.path}`);
					res.push(dependency.path, dependency.headers, function(err, stream) {
						if (err) return;
						fs.createReadStream(dependency.absPath).pipe(stream);
					});
				})
				console.log(`Sending requested file: ${pathname}`);
				res.setHeader('Content-type', MIMES[extension] || 'text/plain');
				res.setHeader('Content-Length', data.length.toString());
				res.send(data);
			}
		});
	}
}

app.use('/', static(path.join(__dirname, 'public')));

spdy.createServer(CONFIG, app)
	.listen(PORT, () => console.log(`Listening on ${PORT} for  HTTP/2...`))
