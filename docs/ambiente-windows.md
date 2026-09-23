# Preparar o computador (Windows + PowerShell)

## 1. Programas (✅ já instalados em 23/09/2026)

| Programa | Para quê | Comando de instalação |
|---|---|---|
| Node.js | Rodar o app localmente e os testes JS | já tinha (v24) |
| Git | Controle de versão | `winget install --id Git.Git -e` |
| VS Code | Editor | `winget install --id Microsoft.VisualStudioCode -e` |
| GitHub CLI (`gh`) | Login no GitHub pelo terminal | `winget install --id GitHub.cli -e` |

Conferir: `node -v; git --version; code --version; gh --version`

## 2. Login no GitHub

> Use um PowerShell **normal** (não precisa "Executar como administrador") e **não trabalhe dentro de `C:\WINDOWS\system32`**.

```powershell
# Identidade dos commits (uma vez só)
git config --global user.name  "Renan"
git config --global user.email "seu-email@exemplo.com"   # o mesmo e-mail da sua conta GitHub

# Login — escolha: GitHub.com > HTTPS > Yes (autenticar o Git) > Login with a web browser
gh auth login

# Conferir: deve mostrar "Logged in to github.com account Renan1"
gh auth status
```

## 3. Baixar o projeto

```powershell
# Pasta de projetos
New-Item -ItemType Directory -Force C:\Projetos | Out-Null
Set-Location C:\Projetos

# Baixar o repositório e entrar na branch de desenvolvimento
gh repo clone Renan1/sistemafinanceiro-familiar
Set-Location sistemafinanceiro-familiar
git switch claude/financas-familia-pwa-319ept

# Abrir no VS Code
code .
```

Para receber atualizações que eu enviar:

```powershell
Set-Location C:\Projetos\sistemafinanceiro-familiar
git pull
```

## 4. Rodar o app no PC (a partir da Fase 2)

```powershell
npx serve .
# abre http://localhost:3000
```

## 5. Extensões do VS Code

Ao abrir a pasta, o VS Code vai sugerir as extensões recomendadas (`.vscode/extensions.json`): Live Server, Prettier, corretor ortográfico pt-BR e SQLTools. Clique em **Install All**.
