<?php
session_start();
date_default_timezone_set('America/Sao_Paulo');
 // Certifique-//se de iniciar a sessão antes de acessar $_SESSION

//include 'funcoes.php';
include 'PontoIndividual.php';
include  'conexao.php';



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

    $idUsuario = $_SESSION["id_usuario"];
    $dia = date('Y-m-d');
    $diaSemana = obterDiaSemana();
    var_dump($diaSemana);
    $horaAtual = date('H:i:s');


// Verifica se é uma requisição POST
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Verifica se a ação foi recebida
    if (isset($_POST['acao'])) {
        $acao = $_POST['acao'];
        echo "Ação recebida: " . $acao . "<br>"; // Depuração
        $tipoRegistro = $acao;
        $ponto = new PontoIndividual($tipoRegistro, $dia, $diaSemana);
        $ponto->registrarPonto($tipoRegistro);

  
        if (isset($_POST['feriado'])) {
        $feriado = $_POST['feriado'];
        echo "Feriado recebido: " . $feriado . "<br>"; // Depuração
        $tipoRegistro = $acao;

    }

}    
 

    
    // Verifica se a preparação da query foi bem-sucedida
        if ($stmt) {
            // Liga os parâmetros
            mysqli_stmt_bind_param($stmt, "sssss", $dia, $diaSemana, $horaAtual, $idUsuario, $justificativa);
    
            // Executa a query
            if (mysqli_stmt_execute($stmt)) {
                echo "Registro de ponto realizado com sucesso!";
            } else {
                echo "Erro ao registrar ponto!";
            }
    
            // Fecha a declaração
            mysqli_stmt_close($stmt);
        } else {
            echo "Erro na preparação da query!";
        }
    }

    






   