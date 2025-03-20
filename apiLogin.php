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

if ($_SERVER["REQUEST_METHOD"] === "POST") {
    $email = $_POST["email"] ?? '';
    $senha = md5($_POST["senha"] ?? '');

    $banco = abrirBanco();

    $sql = "SELECT * FROM usuarius WHERE email = ? AND senha = ?";
    $stmt = $banco->prepare($sql);
    
    if (!$stmt) {
        echo json_encode(["status" => "error", "message" => "Erro na preparação da consulta: " . $banco->error]);
        exit();
    }

    $stmt->bind_param("ss", $email, $senha);
    $stmt->execute();
    $result = $stmt->get_result();
    $stmt->close();

    if ($result && $result->num_rows > 0) {
        $row = $result->fetch_assoc();

        $_SESSION["id_usuario"] = $row["id"];
        $_SESSION["nome_usuario"] = $row["nome"];
        $_SESSION["opcao"] = $row["opcao"];

        // Retorne os dados do usuário e o status de sucesso
        echo json_encode([
            "status" => "success",
            "user" => [
                "id" => $row["id"],
                "nome" => $row["nome"],
                "opcao" => $row["opcao"]
            ]
        ]);
    } else {
        // Retorne uma mensagem de erro
        echo json_encode([
            "status" => "error",
            "message" => "Email ou senha incorretos."
        ]);
    }

    $banco->close();
    exit();
}
?>
