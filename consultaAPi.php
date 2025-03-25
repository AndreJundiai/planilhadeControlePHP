<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *"); // Permite requisições de qualquer domínio
header("Access-Control-Allow-Methods: GET");
header("Access-Control-Allow-Headers: Content-Type");

session_start();

// Conexão com o banco de dados
$host = 'localhost';
$usuario = 'root';
$senha = '1234';
$banco = 'novoBD';
$conexao = mysqli_connect($host, $usuario, $senha, $banco);

if (mysqli_connect_errno()) {
    echo json_encode(["erro" => "Falha na conexão com o banco de dados: " . mysqli_connect_error()]);
    exit;
}

// Verifica se o usuário está autenticado
if (!isset($_SESSION["id_usuario"])) {
    echo json_encode(["erro" => "Usuário não autenticado."]);
    exit;
}

$idUsuario = mysqli_real_escape_string($conexao, $_SESSION["id_usuario"]);

// Consulta os registros de ponto do usuário
$query = "SELECT dia, diaSemana, hora_entrada, hora_almoço_entrada, hora_almoço_saida, hora_saida, bancodeHoras 
          FROM pontoRegistro WHERE idUsuario = '$idUsuario'";

$resultado = mysqli_query($conexao, $query);

if (!$resultado) {
    echo json_encode(["erro" => "Erro na consulta: " . mysqli_error($conexao)]);
    exit;
}

$registros = [];
while ($registro = mysqli_fetch_assoc($resultado)) {
    $registros[] = $registro;
}

// Consulta o nome do usuário
$query = "SELECT nome FROM usuarius WHERE id = '$idUsuario'";
$resultado2 = mysqli_query($conexao, $query);

if (!$resultado2) {
    echo json_encode(["erro" => "Erro na consulta do usuário: " . mysqli_error($conexao)]);
    exit;
}

$nomeUsuario = "";
if ($row = mysqli_fetch_assoc($resultado2)) {
    $nomeUsuario = $row['nome'];
}

// Retorna os dados como JSON
$response = [
    "nomeUsuario" => $nomeUsuario,
    "registros" => $registros
];

echo json_encode($response);
?>
