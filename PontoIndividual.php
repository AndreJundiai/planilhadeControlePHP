<?php
include 'conexao.php';

class PontoIndividual {
    private $tipoRegistro;
    private $dia;
    private $diaSemana;

    public function __construct($tipoRegistro, $dia, $diaSemana) {
        $this->tipoRegistro = $tipoRegistro;
        $this->dia = $dia;
        $this->diaSemana = $diaSemana;
    }

    function registrarPonto($tipoRegistro) {
        global $conexao, $dia, $diaSemana, $horaAtual, $idUsuario;
    
        // Verifica se há justificativa
        $justificativa = isset($_POST['mostrarTexto']) ? $_POST['textoParaMostrar'] : "";

         // Verifica se já existe um registro no mesmo dia
    $queryCheck = "SELECT id FROM pontoRegistro WHERE dia = ? AND idUsuario = ?";
    $stmtCheck = mysqli_prepare($conexao, $queryCheck);
    
    if ($stmtCheck) {
        mysqli_stmt_bind_param($stmtCheck, "si", $dia, $idUsuario);
        mysqli_stmt_execute($stmtCheck);
        mysqli_stmt_store_result($stmtCheck);
        
        if (mysqli_stmt_num_rows($stmtCheck) > 0) {
            echo "Erro: Registro para este dia já existe.";
            mysqli_stmt_close($stmtCheck);
            return;
        }
    
    
        switch ($tipoRegistro) {
            case "Registrar Entrada":
                $query = "INSERT INTO pontoRegistro (dia, diaSemana, hora_entrada, idUsuario) VALUES (?, ?, ?, ?)";
                break;
            case "Registrar Inicio Almoço":
                $query = "UPDATE pontoRegistro SET hora_almoço_entrada = ? WHERE dia = ? AND idUsuario = ?";
                break;
            case "Registrar Fim Almoço":
                $query = "UPDATE pontoRegistro SET hora_almoço_saida = ? WHERE dia = ? AND idUsuario = ?";
                break;
            case "Registrar Saída":
                 $query = "UPDATE pontoRegistro SET hora_saida = ? WHERE dia = ? AND idUsuario = ?";
                    break;
            default:
                echo "Tipo de registro inválido.";
                return;
        }
    
        $stmt = mysqli_prepare($conexao, $query);
        if ($stmt) {
            if ($tipoRegistro === "Registrar Entrada") {
                mysqli_stmt_bind_param($stmt, "sssi", $dia, $diaSemana, $horaAtual, $idUsuario);
            } else {
                mysqli_stmt_bind_param($stmt, "ssi", $horaAtual, $dia, $idUsuario);
            }
    
            if (mysqli_stmt_execute($stmt)) {
                echo "Registro " . ($tipoRegistro === "Registrar Entrada" ? "inserido" : "atualizado") . " com sucesso.";
            } else {
                echo "Erro ao processar registro: " . mysqli_stmt_error($stmt);
            }
            mysqli_stmt_close($stmt);
        } else {
            echo "Erro na preparação da consulta: " . mysqli_error($conexao);
        }
    }
}    
}
?>
