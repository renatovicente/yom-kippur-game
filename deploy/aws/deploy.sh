#!/usr/bin/env bash
# Implanta o jogo na AWS (S3 privado + CloudFront).
#
# Uso:
#   ./deploy.sh                      # usa o profile/região padrão do AWS CLI
#   AWS_PROFILE=meu-profile ./deploy.sh
#   ./deploy.sh --stack outro-nome
#
# Pré-requisitos: AWS CLI v2 autenticado (aws sso login, se aplicável).
set -euo pipefail

STACK="yom-kippur-game"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack) STACK="$2"; shift 2 ;;
    *) echo "opção desconhecida: $1"; exit 1 ;;
  esac
done

DIR="$(cd "$(dirname "$0")" && pwd)"
WEB="$DIR/../../web"

echo "==> Verificando credenciais AWS…"
aws sts get-caller-identity --query Account --output text >/dev/null || {
  echo "Falha de autenticação. Rode 'aws configure' ou 'aws sso login' antes."; exit 1;
}

echo "==> Criando/atualizando a stack CloudFormation '$STACK'…"
aws cloudformation deploy \
  --stack-name "$STACK" \
  --template-file "$DIR/template.yaml" \
  --no-fail-on-empty-changeset

BUCKET=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='Bucket'].OutputValue" --output text)
DIST=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='DistribuicaoId'].OutputValue" --output text)
URL=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='URLJogo'].OutputValue" --output text)

echo "==> Sincronizando arquivos para s3://$BUCKET…"
aws s3 sync "$WEB" "s3://$BUCKET" --delete

echo "==> Invalidando o cache do CloudFront…"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/*' \
  --query 'Invalidation.Id' --output text

echo
echo "✅ Jogo publicado em: $URL"
echo "   (a primeira propagação do CloudFront pode levar alguns minutos)"
