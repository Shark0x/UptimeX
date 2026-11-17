# Downloads do agente uptimeX

Diretorio servido pelo frontend. Os pacotes e o manifesto sao gerados com:

```sh
python3 agent-installer/build.py --publish
```

No Windows, use `--windows --publish` para construir tambem o executavel com
o icone oficial. Execute a partir da raiz do repositorio antes do build do
frontend. Consulte `agent-installer/README.md` para os requisitos de build.

Pacotes gerados e manifesto nao sao versionados. A interface nao oferece links
para pacotes ausentes. O conteudo desta pasta e publico: nao colocar segredos.
