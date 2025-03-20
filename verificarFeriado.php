<?php
function verificarFeriadoBrasilAPI($data, $estado = null, $cidade = null) {
    // Montar a URL da API
    $url = "https://brasilapi.com.br/api/feriados/v1/$data";

    // Configurar cURL
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "Content-Type: application/json"
    ]);

    // Executar a requisição
    $response = curl_exec($ch);

    // Verificar erros na execução
    if (curl_errno($ch)) {
        return "Erro ao conectar com a API: " . curl_error($ch);
    }

    curl_close($ch);

    // Parsear a resposta
    $feriados = json_decode($response, true);

    // Verificar se a data é um feriado
    if (!empty($feriados)) {
        foreach ($feriados as $feriado) {
            if ($feriado['date'] === $data) {
                return "Feriado: " . $feriado['name'];
            }
        }
    }

    // Caso não seja feriado
    return "Não é feriado.";
}

// Exemplo de uso
$data = "2024-12-25"; // Data a ser verificada
$resultado = verificarFeriadoBrasilAPI($data);

// Exibir o resultado
echo "Resultado para $data: $resultado";
?>
