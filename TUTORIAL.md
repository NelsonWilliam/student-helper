## Preparando o Ubuntu

- Instale o Yarn

```
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list
sudo apt-get update && sudo apt-get install yarn
```

- Instale o Node v8.x

```
curl -sL https://deb.nodesource.com/setup_8.x | sudo -E bash -
sudo apt-get update
sudo apt-get install -y nodejs
sudo apt-get install -y build-essential
sudo apt-get autoremove
```

- Instale o node-gyp

```
sudo npm install -g node-gyp
```

## Preparando o projeto

- Clone o repositório

```
git clone https://github.com/NelsonWilliam/AjudanteDoAluno/
```

- Instale as ferramentas

```
cd AjudanteDoAluno/Tools
npm install
```

## Executando para testar

- Vá para a pasta do Electron

```
cd AjudanteDoAluno/ElectronClient/
```

- Execute o script

```
./run.sh
```

- O programa será aberto.

## Fazendo uma build

- Vá para a pasta app do Electron

```
cd AjudanteDoAluno/ElectronClient/app
```

- Sincronize as bibliotecas

```
rsync --delete -a ../../ReactNativeClient/lib/ lib/
```

- Atualize as dependências

```
npm install
```

- Rode o Yarn

```
yarn dist
```

- Depois disto surgirá um arquivo .AppImage na pasta 'dist'.
