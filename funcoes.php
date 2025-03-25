<?php
include 'conexao.php';
 
 
 
function registrarPonto($tipoRegistro) {
    global $conexao, $dia, $diaSemana, $horaAtual, $idUsuario;

    // Verifica se há justificativa
    $justificativa = isset($_POST['mostrarTexto']) ? $_POST['textoParaMostrar'] : "";


    if ($tipoRegistro == "hora_entrada") {
        $query = "INSERT INTO pontoRegistro (dia, diaSemana, $tipoRegistro, idUsuario, justificativa) VALUES (?, ?, ?, ?, ?)";
        $stmt = mysqli_prepare($conexao, $query);
    } else {
        $query = "UPDATE pontoRegistro SET $tipoRegistro = ? WHERE dia = ?";
        $stmt = mysqli_prepare($conexao, $query);
        mysqli_stmt_bind_param($stmt, "ss", $horaAtual, $dia);
    }


}






?>
