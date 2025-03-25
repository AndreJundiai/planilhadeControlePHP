<?php
session_start();

header('Content-Type: application/json'); // Define o cabeçalho para JSON



function abrirBanco(): mysqli {
    $conexao = new mysqli("localhost", "root", "1234", "novoBD");
    
    if ($conexao->connect_error) {
        die(json_encode(["status" => "error", "message" => "Erro de conexão com o banco de dados: " . $conexao->connect_error]));
    }
    
    return $conexao;
}


   // Função para obter o dia da semana
    function obterDiaSemana() {
        $diaDaSemana = date("N");
        $dias = [
            1 => "Segunda-feira",
            2 => "Terça-feira",
            3 => "Quarta-feira",
            4 => "Quinta-feira",
            5 => "Sexta-feira",
            6 => "Sábado",
            7 => "Domingo"
        ];

        return $dias[$diaDaSemana] ?? "Dia inválido";
    }




if ($_SERVER["REQUEST_METHOD"] === "POST") {
    // Lê o JSON do corpo da requisição
    $input = json_decode(file_get_contents('php://input'), true);

    // Verifica se o campo 'hora_entrada' foi passado
    if (!isset($input['hora_entrada'] && !isset($input['dia_semana']  && !isset($input['dia']  )) {
        echo json_encode(["status" => "error", "message" => "Hora de entrada não fornecida"]);
        exit();
    }

    $horaentrada = $input['hora_entrada'];

    $banco = abrirBanco();

    // Corrigido o SQL
    $sql = "INSERT INTO pontoRegistro (hora_entrada) VALUES (?)";
    $stmt = $banco->prepare($sql);
    
    if (!$stmt) {
        echo json_encode(["status" => "error", "message" => "Erro na preparação da consulta: " . $banco->error]);
        exit();
    }

    // Corrigido o parâmetro para horaentrada
    $stmt->bind_param("s", $horaentrada);
    $stmt->execute();

    // Verifica se a inserção foi bem-sucedida
    if ($stmt->affected_rows > 0) {
        // Salve a hora_entrada na sessão
        $_SESSION["hora_entrada"] = $horaentrada;

        // Retorne o status de sucesso
        echo json_encode([
            "status" => "success",
            "hora_entrada" => $horaentrada
        ]);
    } else {
        // Retorne uma mensagem de erro
        echo json_encode([
            "status" => "error",
            "message" => "Erro ao registrar a hora de entrada."
        ]);
    }

    $stmt->close();
    $banco->close();
    exit();
}
?>
